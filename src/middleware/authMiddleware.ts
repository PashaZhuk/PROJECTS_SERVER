import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { type User, Role } from '../../generated/prisma/client.js'

interface JwtPayload {
  id: string;
}

interface AuthRequest extends Request {
  user?: User; 
}

export const authMiddleware = async (
  req: AuthRequest, 
  res: Response, 
  next: NextFunction
) => {
  let token: string | undefined;

  // 1. Получение токена
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return res.status(401).json({ error: "Not authorized, no token provided" });
  }

  try {
    // 2. Верификация токена
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    const userId = Number(decoded.id);

    if (isNaN(userId)) {
      return res.status(401).json({ error: "Invalid user ID format" });
    }

    // 3. Проверка существования пользователя в БД
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      console.log(`Auth Error: User with ID ${userId} not found`);
      return res.status(401).json({ error: "User no longer exists" });
    }

    // 4. Обновление статуса "Online" (lastSeen)
    // Делаем это без await, чтобы не задерживать ответ пользователю (фон)
    prisma.user.update({
      where: { id: userId },
      data: { lastSeen: new Date() }
    }).catch(err => console.error("Background lastSeen update failed:", err));

    // 5. Передача данных дальше
    req.user = user;
    next();

  } catch (err: any) {
    return res.status(401).json({ error: "Not authorized, token failed" });
  }
};

