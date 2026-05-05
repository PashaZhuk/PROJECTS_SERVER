import type  { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';

export const errorHandler = (
  err: Error | AppError | ZodError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let statusCode = 500;
  let message = 'Внутренняя ошибка сервера';
  let details: any = null;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Ошибка валидации данных';
    if (process.env.NODE_ENV === 'development') {
      details = err.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      }));
    }
  } else {
    console.error('UNHANDLED ERROR:', err);
    if (process.env.NODE_ENV === 'development') {
      message = err.message;
    }
  }

  res.status(statusCode).json({
    status: 'error',
    message,
    ...(details && { details }),
  });
};