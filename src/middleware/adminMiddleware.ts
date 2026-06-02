import type { Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

// Используем тот же интерфейс AuthRequest, что и в authMiddleware
export const adminMiddleware = (req: any, res: Response, next: NextFunction) => {
  // req.user заполняется предыдущим мидлваром (authMiddleware)
  if (req.user && req.user.role === 'ADMIN') {
    next(); // Если админ, идем дальше к контроллеру
  } else {
    // Если не админ — возвращаем 403 Forbidden
    sendError(res, 403, "Доступ запрещен. Требуются права администратора.");
  }
};