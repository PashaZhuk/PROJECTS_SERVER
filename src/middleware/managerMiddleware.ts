import type { Response, NextFunction } from 'express';

export const managerMiddleware = (req: any, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'MANAGER') {
    console.log("manager<iddleware is reached")
    next();
  } else {
    res.status(403).json({ 
      error: "Доступ запрещен. Эта секция только для менеджеров." 
    });
  }
};