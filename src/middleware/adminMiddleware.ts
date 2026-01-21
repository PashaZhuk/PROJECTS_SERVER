import type { Response, NextFunction } from 'express';

// Используем тот же интерфейс AuthRequest, что и в authMiddleware
export const adminMiddleware = (req: any, res: Response, next: NextFunction) => {
  // req.user заполняется предыдущим мидлваром (authMiddleware)
  if (req.user && req.user.role === 'ADMIN') {
    next(); // Если админ, идем дальше к контроллеру
  } else {
    // Если не админ — возвращаем 403 Forbidden
    res.status(403).json({ 
      error: "Доступ запрещен. Требуются права администратора." 
    });
  }
};