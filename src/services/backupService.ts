import { exec, execSync, spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import logger from '../utils/logger.js';

// ─── Конфигурация ───

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const CONTAINER_NAME = 'projects_postgres_18';
const DB_NAME = 'b2b_portal';
const DB_USER = 'admin';

// ─── Состояние планировщика ───

let scheduledTask: ScheduledTask | null = null;
let currentSchedule: string | null = null;
let onBackupComplete: ((success: boolean, filename?: string) => void) | null = null;

// ─── Утилиты ───

function ensureBackupDir(): Promise<void> {
  return fs.mkdir(BACKUP_DIR, { recursive: true }).then(() => {});
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// ─── Проверка доступности Docker/контейнера ───

async function checkDockerAvailable(): Promise<boolean> {
  try {
    execSync(`docker ps --format "{{.Names}}"`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function checkContainerRunning(): Promise<boolean> {
  try {
    const out = execSync(
      `docker ps --filter "name=${CONTAINER_NAME}" --format "{{.Names}}"`,
      { stdio: 'pipe', timeout: 5000 }
    ).toString().trim();
    return out === CONTAINER_NAME;
  } catch {
    return false;
  }
}

// ─── Создание бэкапа ───

export async function createBackup(): Promise<{ success: boolean; filename?: string; error?: string }> {
  await ensureBackupDir();

  const dockerOk = await checkDockerAvailable();
  if (!dockerOk) {
    return { success: false, error: 'Docker не найден. Убедитесь, что Docker Desktop запущен.' };
  }

  const containerOk = await checkContainerRunning();
  if (!containerOk) {
    return { success: false, error: `Контейнер ${CONTAINER_NAME} не запущен. Запустите docker compose up.` };
  }

  const filename = `backup_${timestamp()}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  return new Promise((resolve) => {
    const cmd = `docker exec ${CONTAINER_NAME} pg_dump -U ${DB_USER} -d ${DB_NAME} --clean --if-exists`;

    exec(cmd, {
      timeout: 120_000, // 2 минуты на бэкап
      maxBuffer: 500 * 1024 * 1024, // 500MB
    }, async (error, stdout, stderr) => {
      if (error) {
        const msg = error.message || '';
        logger.error(`[backup] exec error: ${msg}`);
        // pg_dump может писать предупреждения в stderr, но это не ошибка
        if (stderr) logger.info(`[pg_dump stderr] ${stderr.trim().slice(0, 500)}`);
        resolve({ success: false, error: `Ошибка pg_dump: ${msg}` });
        return;
      }

      if (stderr) {
        // pg_dump пишет предупреждения/прогресс в stderr — логируем, не считаем ошибкой
        logger.info(`[pg_dump stderr] ${stderr.trim().slice(0, 500)}`);
      }

      try {
        if (!stdout || stdout.trim().length === 0) {
          resolve({ success: false, error: 'Бэкап пуст — база данных не содержит данных?' });
          return;
        }
        await fs.writeFile(filepath, stdout, 'utf-8');
        const sizeMB = (Buffer.byteLength(stdout, 'utf-8') / 1024 / 1024).toFixed(1);
        logger.info(`[backup] saved: ${filename} (${sizeMB} MB)`);
        resolve({ success: true, filename });
      } catch (err: any) {
        logger.error(`[backup] write error: ${err.message}`);
        resolve({ success: false, error: `Ошибка записи файла: ${err.message}` });
      }
    });
  });
}

// ─── Восстановление из бэкапа ───

export async function restoreBackup(filename: string): Promise<{ success: boolean; error?: string }> {
  await ensureBackupDir();

  // Защита от directory traversal
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return { success: false, error: 'Некорректное имя файла' };
  }

  const filepath = path.join(BACKUP_DIR, filename);

  // Проверяем, существует ли файл
  try {
    await fs.access(filepath);
  } catch {
    return { success: false, error: 'Файл бэкапа не найден' };
  }

  const dockerOk = await checkDockerAvailable();
  if (!dockerOk) {
    return { success: false, error: 'Docker не найден. Убедитесь, что Docker Desktop запущен.' };
  }

  const containerOk = await checkContainerRunning();
  if (!containerOk) {
    return { success: false, error: `Контейнер ${CONTAINER_NAME} не запущен.` };
  }

  return new Promise(async (resolve) => {
    try {
      const sqlContent = await fs.readFile(filepath, 'utf-8');

      if (!sqlContent || sqlContent.trim().length === 0) {
        resolve({ success: false, error: 'Файл бэкапа пуст' });
        return;
      }

      const proc = spawn('docker', [
        'exec', '-i', CONTAINER_NAME,
        'psql', '-U', DB_USER, '-d', DB_NAME,
      ], {
        timeout: 300_000, // 5 минут на восстановление
      });

      let errorOutput = '';

      proc.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) logger.info(`[restore stdout] ${msg.slice(0, 300)}`);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          errorOutput += msg + '\n';
          logger.info(`[restore stderr] ${msg.slice(0, 300)}`);
        }
      });

      // Пишем SQL в stdin процесса
      proc.stdin.write(sqlContent);
      proc.stdin.end();

      proc.on('error', (err) => {
        logger.error(`[restore] spawn error: ${err.message}`);
        resolve({ success: false, error: `Ошибка запуска psql: ${err.message}` });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          logger.info(`[restore] success: ${filename}`);
          resolve({ success: true });
        } else {
          // NOTICE и другие информационные сообщения psql пишет в stderr — 
          // это не всегда ошибка. Но если exit code != 0, значит реальная проблема.
          logger.error(`[restore] psql exited with code ${code}`);
          const brief = errorOutput.slice(0, 500).trim();
          resolve({ success: false, error: `psql завершился с кодом ${code}${brief ? ': ' + brief : ''}` });
        }
      });
    } catch (err: any) {
      logger.error(`[restore] error: ${err.message}`);
      resolve({ success: false, error: `Ошибка восстановления: ${err.message}` });
    }
  });
}

// ─── Список бэкапов ───

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  sizeHuman: string;
  createdAt: string;
}

export async function listBackups(): Promise<BackupFileInfo[]> {
  await ensureBackupDir();

  const files = await fs.readdir(BACKUP_DIR);
  const sqlFiles = files.filter(f => f.endsWith('.sql')).sort().reverse();

  const result: BackupFileInfo[] = [];

  for (const f of sqlFiles) {
    try {
      const stat = await fs.stat(path.join(BACKUP_DIR, f));
      const sizeBytes = stat.size;
      const sizeHuman = sizeBytes < 1024 * 1024
        ? `${(sizeBytes / 1024).toFixed(0)} KB`
        : `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;

      // Извлекаем дату из имени файла: backup_2026-05-14_15-30-00.sql
      const dateMatch = f.match(/backup_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})\.sql/);
      const createdAt = dateMatch
        ? `${dateMatch[1]} ${dateMatch[2]}:${dateMatch[3]}:${dateMatch[4]}`
        : stat.birthtime.toISOString().replace('T', ' ').slice(0, 19);

      result.push({ filename: f, sizeBytes, sizeHuman, createdAt });
    } catch {
      // файл мог удалиться между readdir и stat
    }
  }

  return result;
}

// ─── Получить путь к файлу бэкапа ───

export function getBackupPath(filename: string): string {
  return path.join(BACKUP_DIR, filename);
}

// ─── Удалить бэкап ───

export async function deleteBackup(filename: string): Promise<boolean> {
  const filepath = path.join(BACKUP_DIR, filename);
  try {
    await fs.unlink(filepath);
    logger.info(`[backup] deleted: ${filename}`);
    return true;
  } catch (err: any) {
    logger.error(`[backup] delete error: ${err.message}`);
    return false;
  }
}

// ─── Планировщик ───

export function getSchedule(): { enabled: boolean; cron: string | null } {
  return {
    enabled: scheduledTask !== null,
    cron: currentSchedule,
  };
}

/**
 * Установить расписание бэкапов.
 * @param cronExpr — cron-выражение (например, "0 3 * * *" — каждый день в 3:00)
 * @param onComplete — колбэк после каждого бэкапа (можно передать setter для UI)
 */
export function setSchedule(
  cronExpr: string,
  onComplete?: (success: boolean, filename?: string) => void
): { success: boolean; error?: string } {
  // Останавливаем старую задачу
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    currentSchedule = null;
  }

  if (!cronExpr || cronExpr.trim() === '') {
    logger.info('[backup] schedule disabled');
    return { success: true };
  }

  // Валидация cron-выражения
  if (!cron.validate(cronExpr)) {
    return { success: false, error: 'Некорректное cron-выражение. Пример: "0 3 * * *" — каждый день в 3:00' };
  }

  if (onComplete) {
    onBackupComplete = onComplete;
  }

  currentSchedule = cronExpr;

  scheduledTask = cron.schedule(cronExpr, async () => {
    logger.info(`[backup] scheduled backup triggered (${cronExpr})`);
    const result = await createBackup();
    if (onBackupComplete) {
      onBackupComplete(result.success, result.filename);
    }
  });

  logger.info(`[backup] schedule set: ${cronExpr}`);
  return { success: true };
}

/** Остановить планировщик */
export function stopSchedule(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    currentSchedule = null;
    logger.info('[backup] schedule stopped');
  }
}
