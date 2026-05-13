import type { Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

export const managerMiddleware = (req: any, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'MANAGER') {
    console.log("managerMiddleware is reached")
    next();
  } else {
    sendError(res, 403, "Доступ запрещен. Эта секция только для менеджеров.");
  }
};