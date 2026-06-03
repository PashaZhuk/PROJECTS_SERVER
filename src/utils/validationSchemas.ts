import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { sendError } from './response.js';

// ----------------------
// USER / AUTH SCHEMAS
// ----------------------

export const loginSchema = z.object({
  email: z.string().regex(/@/, 'Некорректный email'),
  password: z.string().min(1, 'Пароль обязателен'),
});

export const registerSchema = z.object({
  email: z.string().regex(/@/, 'Некорректный email'),
  password: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
  name: z.string().optional(),
  role: z.enum(['USER', 'MANAGER', 'ADMIN']).optional(),
  companyName: z.string().optional(),
  unp: z.string().optional(),
  phone: z.string().regex(/^\+375\d{9}$/, 'Формат: +375XXXXXXXXX'),
}).superRefine((data, ctx) => {
  if (data.role === 'MANAGER' && !data.name) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'Для менеджера обязательно ФИО' });
  }
  if (data.role === 'USER' && (!data.companyName || !data.unp)) {
    ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Для партнера обязательны название компании и УНП' });
  }
});

export const changePasswordSchema = z.object({
  newPassword: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().regex(/@/, 'Некорректный email'),
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
// BROADCAST SCHEMA (доведение информации)
// ----------------------

const ALLOWED_BROADCAST_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.txt'];
const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB (лимит Yandex SMTP)

const broadcastAttachmentSchema = z.object({
  filename: z.string().min(1, 'Имя файла не может быть пустым'),
  content: z.string().min(1, 'Содержимое файла пустое'),
  encoding: z.string().optional(),
}).refine(
  (att) => {
    const ext = '.' + (att.filename.split('.').pop()?.toLowerCase() || '');
    return ALLOWED_BROADCAST_EXTENSIONS.includes(ext);
  },
  { message: `Недопустимый тип файла. Разрешены: ${ALLOWED_BROADCAST_EXTENSIONS.join(', ')}` }
);

export const broadcastSchema = z.object({
  recipientIds: z.array(z.number().int().positive()).min(1, 'Выберите хотя бы одного получателя'),
  subject: z.string().min(1, 'Тема обязательна').max(255, 'Тема не может быть длиннее 255 символов'),
  message: z.string().min(1, 'Текст сообщения обязателен').max(50000, 'Сообщение не может быть длиннее 50 000 символов'),
  attachments: z.array(broadcastAttachmentSchema).optional(),
}).superRefine((data, ctx) => {
  if (data.attachments && data.attachments.length > 0) {
    const totalSize = data.attachments.reduce((sum, att) => {
      return sum + Math.ceil(att.content.length * 3 / 4);
    }, 0);
    if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: `Общий размер вложений превышает 25 MB`,
      });
    }
  }
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
        return sendError(res, 400, 'Ошибка валидации данных', { errors });
      }
      next(error);
    }
  };
};