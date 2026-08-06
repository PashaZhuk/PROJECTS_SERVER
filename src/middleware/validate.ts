import type { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { sendError } from '../utils/response.js';

export const validate = (schema: z.ZodTypeAny) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Валидируем тело запроса
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // B5: используем sendError для единого формата { success: false, error, errors }
        const errors = error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        return sendError(res, 400, 'Ошибка валидации данных', { errors });
      }
      next(error);
    }
  };
};
