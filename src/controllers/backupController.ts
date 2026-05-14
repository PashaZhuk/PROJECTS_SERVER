import type { Request, Response } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../utils/response.js';
import {
  createBackup,
  listBackups,
  getBackupPath,
  deleteBackup,
  restoreBackup,
  uploadMiddleware,
  getSchedule,
  setSchedule,
  stopSchedule,
} from '../services/backupService.js';
import fs from 'fs';

/** POST /api/admin/backup/create — создать бэкап */
export const createBackupHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = await createBackup();
  if (result.success) {
    sendSuccess(res, { filename: result.filename }, 'Бэкап создан');
  } else {
    sendError(res, 500, result.error || 'Ошибка создания бэкапа');
  }
});

/** POST /api/admin/backup/upload — загрузить .sql файл */
export const uploadBackupHandler = asyncHandler(async (req: Request, res: Response) => {
  uploadMiddleware(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        sendError(res, 413, 'Файл слишком большой (максимум 500 MB)');
      } else {
        sendError(res, 400, err.message || 'Ошибка загрузки файла');
      }
      return;
    }

    if (!req.file) {
      sendError(res, 400, 'Файл не выбран');
      return;
    }

    sendSuccess(res, { filename: req.file.filename }, 'Файл загружен');
  });
});

/** GET /api/admin/backup/list — список бэкапов */
export const listBackupsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const backups = await listBackups();
  sendSuccess(res, backups);
});

/** GET /api/admin/backup/download/:filename — скачать бэкап */
export const downloadBackupHandler = asyncHandler(async (req: Request, res: Response) => {
  const filename = req.params.filename;

  // Защита от directory traversal
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    sendError(res, 400, 'Некорректное имя файла');
    return;
  }

  const filepath = getBackupPath(filename);

  try {
    await fs.promises.access(filepath);
  } catch {
    sendError(res, 404, 'Файл не найден');
    return;
  }

  res.download(filepath, filename);
});

/** DELETE /api/admin/backup/:filename — удалить бэкап */
export const deleteBackupHandler = asyncHandler(async (req: Request, res: Response) => {
  const filename = req.params.filename;

  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    sendError(res, 400, 'Некорректное имя файла');
    return;
  }

  const ok = await deleteBackup(filename);
  if (ok) {
    sendSuccess(res, undefined, 'Бэкап удалён');
  } else {
    sendError(res, 404, 'Файл не найден');
  }
});

/** POST /api/admin/backup/restore/:filename — восстановить БД из бэкапа */
export const restoreBackupHandler = asyncHandler(async (req: Request, res: Response) => {
  const filename = req.params.filename;

  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    sendError(res, 400, 'Некорректное имя файла');
    return;
  }

  const result = await restoreBackup(filename);
  if (result.success) {
    sendSuccess(res, undefined, 'База данных восстановлена из бэкапа');
  } else {
    sendError(res, 500, result.error || 'Ошибка восстановления');
  }
});

/** GET /api/admin/backup/schedule — текущее расписание */
export const getScheduleHandler = asyncHandler(async (_req: Request, res: Response) => {
  const schedule = getSchedule();
  sendSuccess(res, schedule);
});

/** PUT /api/admin/backup/schedule — установить расписание */
export const setScheduleHandler = asyncHandler(async (req: Request, res: Response) => {
  const { cron: cronExpr } = req.body;

  if (cronExpr === undefined) {
    sendError(res, 400, 'Не указано cron-выражение');
    return;
  }

  const result = setSchedule(cronExpr);
  if (result.success) {
    sendSuccess(res, getSchedule(), 'Расписание обновлено');
  } else {
    sendError(res, 400, result.error || 'Ошибка установки расписания');
  }
});
