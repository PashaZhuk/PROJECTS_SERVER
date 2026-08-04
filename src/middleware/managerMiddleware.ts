import type { Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';
import type { AuthRequest } from '../types/express.js';

export const managerMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'MANAGER') {
    next();
  } else {
    sendError(res, 403, "Доступ запрещен. Эта секция только для менеджеров.");
  }
};
