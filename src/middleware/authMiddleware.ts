import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { sendError } from '../utils/response.js';
import logger from '../utils/logger.js';
import type { AuthRequest } from '../types/express.js';

interface JwtPayload {
  id: string;
  sessionId?: string;
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
    return sendError(res, 401, "Not authorized, no token provided");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    const userId = Number(decoded.id);

    if (isNaN(userId)) {
      return sendError(res, 401, "Invalid user ID format");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyName: true,
        unp: true,
        phone: true,
        mustChangePassword: true,
        isBlocked: true,
        currentSessionId: true,
        lastSeen: true,
      }
    });

    if (!user) {
      return sendError(res, 401, "User no longer exists");
    }

    if (user.isBlocked) {
      return sendError(res, 403, "Ваш аккаунт заблокирован. Обратитесь к администратору.", { code: "USER_BLOCKED" });
    }

    if (decoded.sessionId && user.currentSessionId !== decoded.sessionId) {
      return sendError(res, 401, "Сессия завершена из-за входа с другого устройства", { code: "SESSION_SUPERSEDED" });
    }

    const now = new Date();
    const lastSeen = new Date(user.lastSeen);
    const diffMinutes = (now.getTime() - lastSeen.getTime()) / (1000 * 60);

    // A3: единая константа неактивности — 2 часа для всех ролей.
    // Если понадобятся различия по ролям — добавить отдельные константы здесь.
    const INACTIVITY_LIMIT_MINUTES = 120;

    if (diffMinutes > INACTIVITY_LIMIT_MINUTES) {
      return sendError(res, 401, "Сессия истекла из-за неактивности", { code: "SESSION_EXPIRED" });
    }

    // B7: обновляем lastSeen реже — раз в 5 минут вместо 60 секунд,
    // чтобы снизить нагрузку на БД при активном использовании.
    const secondsSinceLastSeen = (now.getTime() - lastSeen.getTime()) / 1000;
    if (secondsSinceLastSeen > 300) {
      await prisma.user.update({
        where: { id: userId },
        data: { lastSeen: now }
      }).catch(err => logger.error("lastSeen update failed:", err));
    }

    // Добавляем информацию о пользователе в logMeta
    req.logMeta = {
      ...(req.logMeta || {}),
      userId: user.id,
      email: user.email,
      name: user.name,
      companyName: user.companyName,
      displayName: user.companyName || user.name || `Пользователь ${user.id}`,
      role: user.role,
    };

    req.user = user;
    next();
  } catch (err: unknown) {
    logger.error("[Auth] Token verification failed:", err instanceof Error ? err.message : String(err));
    return sendError(res, 401, "Not authorized, token failed");
  }
};