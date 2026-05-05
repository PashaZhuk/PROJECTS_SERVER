import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';

interface JwtPayload {
  id: string;
  sessionId?: string;
}

interface AuthRequest extends Request {
  user?: any;
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  let token: string | undefined;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return res.status(401).json({ error: "Not authorized, no token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    const userId = Number(decoded.id);

    if (isNaN(userId)) {
      return res.status(401).json({ error: "Invalid user ID format" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(401).json({ error: "User no longer exists" });
    }

    // 🚫 ПРОВЕРКА БЛОКИРОВКИ
    if (user.isBlocked) {
      return res.status(403).json({
        error: "Ваш аккаунт заблокирован. Обратитесь к администратору.",
        code: "USER_BLOCKED"
      });
    }

    // 🔐 ПРОВЕРКА ВЫТЕСНЕНИЯ СЕССИИ
    if (decoded.sessionId && user.currentSessionId !== decoded.sessionId) {
      return res.status(401).json({ 
        error: "Сессия завершена из-за входа с другого устройства",
        code: "SESSION_SUPERSEDED" 
      });
    }

    // ⏳ ПРОВЕРКА ТАЙМАУТА НЕАКТИВНОСТИ
    const now = new Date();
    const lastSeen = new Date(user.lastSeen);
    const diffMinutes = (now.getTime() - lastSeen.getTime()) / (1000 * 60);
    
    const LIMIT_USER = 1;
    const LIMIT_OTHERS = 120;
    const limit = user.role === 'USER' ? LIMIT_USER : LIMIT_OTHERS;

    if (diffMinutes > limit) {
      return res.status(401).json({ 
        error: "Сессия истекла из-за неактивности",
        code: "SESSION_EXPIRED" 
      });
    }

    // 🔄 ОБНОВЛЕНИЕ АКТИВНОСТИ
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeen: new Date() }
    }).catch(err => console.error("lastSeen update failed:", err));

    req.user = user;
    next();
  } catch (err: any) {
    console.error("[Auth] Token verification failed:", err.message);
    return res.status(401).json({ error: "Not authorized, token failed" });
  }
};