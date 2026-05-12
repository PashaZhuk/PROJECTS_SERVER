import type { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

export const validate = (schema: z.ZodObject<any, any> | z.ZodEffects<any>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Валидируем тело запроса
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        return res.status(400).json({ 
          status: 'error', 
          message: 'Ошибка валидации данных', 
          errors 
        });
      }
      next(error);
    }
  };
};