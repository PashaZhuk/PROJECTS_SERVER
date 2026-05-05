import fs from 'fs/promises';
import path from 'path';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import logger from '../utils/logger';
import type { Request, Response } from 'express';

const LOG_DIR = path.join(process.cwd(), 'logs');
const MAX_LINES = 2000;

// Вспомогательная функция: получить список файлов логов за указанный период
async function getLogFiles(date?: string): Promise<string[]> {
  try {
    await fs.access(LOG_DIR);
  } catch {
    return [];
  }
  const files = await fs.readdir(LOG_DIR);
  // Фильтруем файлы combined-YYYY-MM-DD.log
  const logFiles = files.filter(f => /^combined-\d{4}-\d{2}-\d{2}\.log$/.test(f));
  if (date) {
    const targetFile = `combined-${date}.log`;
    return logFiles.includes(targetFile) ? [path.join(LOG_DIR, targetFile)] : [];
  }
  // Если дата не указана, берём последние 3 файла (по дате в имени)
  logFiles.sort().reverse(); // сначала новые
  return logFiles.slice(0, 3).map(f => path.join(LOG_DIR, f));
}

export const getLogs = asyncHandler(async (req: Request, res: Response) => {
  const level = (req.query.level as string)?.toLowerCase();
  const search = (req.query.search as string)?.toLowerCase() || '';
  const limit = Math.min(parseInt(req.query.limit as string) || 500, MAX_LINES);
  const date = req.query.date as string | undefined; // формат YYYY-MM-DD

  const filesToRead = await getLogFiles(date);
  if (filesToRead.length === 0) {
    return res.json({ logs: [], total: 0, returned: 0 });
  }

  const allEntries: any[] = [];

  for (const filePath of filesToRead) {
    try {
      const stats = await fs.stat(filePath);
      if (stats.size === 0) continue;
      const readSize = Math.min(stats.size, 1024 * 1024); // 1 МБ
      const buffer = Buffer.alloc(readSize);
      const fd = await fs.open(filePath, 'r');
      await fd.read(buffer, 0, readSize, stats.size - readSize);
      await fd.close();
      const content = buffer.toString('utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry && entry.timestamp && entry.level) {
            allEntries.push(entry);
          }
        } catch {
          // пропускаем битые строки
        }
      }
    } catch (err) {
      logger.error(`Failed to read log file ${filePath}`, { error: err });
    }
  }

  // Сортировка по времени (от новых к старым)
  allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  let filtered = allEntries;
  if (level && ['info', 'warn', 'error'].includes(level)) {
    filtered = filtered.filter(entry => entry.level === level);
  }
  if (search) {
    filtered = filtered.filter(entry =>
      JSON.stringify(entry).toLowerCase().includes(search)
    );
  }
  const logs = filtered.slice(0, limit);

  res.json({ logs, total: filtered.length, returned: logs.length });
});