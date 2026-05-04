import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// ----------------------
// USER / AUTH SCHEMAS
// ----------------------

export const loginSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(1, 'Пароль обязателен'),
});

export const registerSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
  name: z.string().optional(),
  role: z.enum(['USER', 'MANAGER']).optional(),
  companyName: z.string().optional(),
  unp: z.string().optional(),
  phone: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.role === 'MANAGER' && !data.name) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'Для менеджера обязательно ФИО' });
  }
  if (data.role === 'USER' && (!data.companyName || !data.unp || !data.phone)) {
    ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Для партнера обязательны название компании, УНП и телефон' });
  }
});

export const changePasswordSchema = z.object({
  newPassword: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Некорректный email'),
});

export const resetPasswordSchema = z.object({
  token: z.string().uuid('Неверный формат токена'),
  newPassword: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
});

export const twoFASendSchema = z.object({
  userId: z.number().int().positive(),
});

export const twoFAVerifySchema = z.object({
  userId: z.number().int().positive(),
  code: z.string().length(6, 'Код должен состоять из 6 цифр'),
});

// ----------------------
// PROJECT SCHEMAS
// ----------------------

export const createProjectSchema = z.object({
  formType: z.string().min(1, 'Не выбран тип формы'),
  customerName: z.string().min(1, 'Укажите наименование заказчика'),
  customerInn: z.string().regex(/^\d{9}$/, 'УНП должен содержать ровно 9 цифр'),
  purchaseMethod: z.string().optional(),
  executionDate: z.string().optional().or(z.date()).or(z.null()),
}).passthrough();

export const updateProjectSchema = createProjectSchema.partial();

export const updateProjectStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'REVISION', 'CLOSED']),
});

// ----------------------
// CHAT SCHEMAS
// ----------------------

export const sendMessageSchema = z.object({
  text: z.string().min(1, 'Сообщение не может быть пустым').max(3000, 'Максимум 3000 символов'),
});

// ----------------------
// MIDDLEWARE ВАЛИДАЦИИ
// ----------------------

export const validate = (schema: z.ZodObject<any, any> | z.ZodEffects<any>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        return res.status(400).json({ status: 'error', message: 'Ошибка валидации данных', errors });
      }
      next(error);
    }
  };
};