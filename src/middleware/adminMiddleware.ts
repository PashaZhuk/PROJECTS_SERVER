import type { Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';
import type { AuthRequest } from '../types/express.js';

// Используем общий интерфейс AuthRequest
export const adminMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  // req.user заполняется предыдущим мидлваром (authMiddleware)
  if (req.user && req.user.role === 'ADMIN') {
    next(); // Если админ, идем дальше к контроллеру
  } else {
    // Если не админ — возвращаем 403 Forbidden
    sendError(res, 403, "Доступ запрещен. Требуются права администратора.");
  }
};
