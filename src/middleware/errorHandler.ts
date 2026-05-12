import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import logger from '../utils/logger';

export const errorHandler = (
  err: Error | AppError | ZodError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let statusCode = 500;
  let message = 'Внутренняя ошибка сервера';
  let details: any = null;

  // Формируем метаданные для лога
  const logMeta = {
    method: req.method,
    url: req.url,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    userId: (req as any).user?.id,
    ...(req.logMeta || {}),
  };

  // Логируем ошибку с уровнем error
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    logger.error(`[AppError] ${message}`, { ...logMeta, statusCode, isOperational: err.isOperational });
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Ошибка валидации данных';
    if (process.env.NODE_ENV === 'development') {
      details = err.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      }));
    }
    logger.warn(`[ValidationError] ${message}`, { ...logMeta, errors: details });
  } else {
    // Неизвестная ошибка
    logger.error(`[UnhandledError] ${err.message}`, { ...logMeta, stack: err.stack });
  }

  res.status(statusCode).json({
    status: 'error',
    message,
    ...(details && { details }),
  });
};