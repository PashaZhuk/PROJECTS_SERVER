import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import type { Response } from 'express';
import { prisma } from '../config/db.js';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_COOKIE_PATH = '/api/auth';

const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Генерирует access JWT (15 мин) и устанавливает его в httpOnly cookie
 */
export const generateAccessToken = (userId: string | number, sessionId: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }

  const payload = { id: userId, sessionId };

  const token = jwt.sign(payload, secret, {
    expiresIn: ACCESS_TOKEN_EXPIRY
  });

  return token;
};

/**
 * Устанавливает access token в httpOnly cookie + возвращает его
 */
export const setAccessTokenCookie = (token: string, res: Response): void => {
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 15 * 60 * 1000, // 15 min
  });
};

/**
 * Создаёт refresh token (7 дней), сохраняет SHA-256 хеш в БД,
 * устанавливает httpOnly cookie с сырым токеном
 */
export const generateAndStoreRefreshToken = async (
  userId: number,
  sessionId: string,
  res: Response
): Promise<string> => {
  const rawToken = uuidv4();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  await prisma.refreshToken.create({
    data: {
      tokenHash,
      userId,
      sessionId,
      expiresAt,
    },
  });

  res.cookie('refreshToken', rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_EXPIRY_MS,
  });

  return rawToken;
};

/**
 * Комбинированная генерация access + refresh токенов
 * Вызывается при логине и после 2FA
 */
export const generateTokens = async (
  userId: number,
  sessionId: string,
  res: Response
): Promise<{ accessToken: string }> => {
  const accessToken = generateAccessToken(userId, sessionId);
  setAccessTokenCookie(accessToken, res);
  await generateAndStoreRefreshToken(userId, sessionId, res);
  return { accessToken };
};

/**
 * Ротация refresh токена (с детектом reuse)
 * Вызывается из POST /api/auth/refresh
 */
export const rotateRefreshToken = async (
  rawToken: string | undefined,
  res: Response
): Promise<{
  success: boolean;
  accessToken?: string;
  user?: any;
  error?: string;
}> => {
  if (!rawToken) {
    return { success: false, error: 'Refresh token not provided' };
  }

  const tokenHash = hashToken(rawToken);
  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!storedToken) {
    res.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH });
    return { success: false, error: 'Invalid refresh token' };
  }

  // Token reuse detection: если токен уже был отозван, это компрометация
  if (storedToken.revokedAt) {
    console.warn(`[RefreshToken] REUSE DETECTED for user ${storedToken.userId}, revoking ALL tokens`);
    await prisma.refreshToken.updateMany({
      where: { userId: storedToken.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH });
    return { success: false, error: 'Token reuse detected — all sessions revoked' };
  }

  // Проверка срока жизни
  if (storedToken.expiresAt < new Date()) {
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });
    res.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH });
    return { success: false, error: 'Refresh token expired' };
  }

  // Ротация: создаём новый, отзываем старый
  const newRawToken = uuidv4();
  const newTokenHash = hashToken(newRawToken);
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date(), replacedByHash: newTokenHash },
    }),
    prisma.refreshToken.create({
      data: {
        tokenHash: newTokenHash,
        userId: storedToken.userId,
        sessionId: storedToken.sessionId,
        expiresAt: newExpiresAt,
      },
    }),
  ]);

  // Новый access token
  const sessionId = storedToken.sessionId || uuidv4();
  const newAccessToken = generateAccessToken(storedToken.userId, sessionId);
  setAccessTokenCookie(newAccessToken, res);

  // Новый refresh токен в cookie
  res.cookie('refreshToken', newRawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_EXPIRY_MS,
  });

  const { password, ...userData } = storedToken.user;
  return {
    success: true,
    accessToken: newAccessToken,
    user: userData,
  };
};

/**
 * Отзыв всех refresh токенов для пользователя (при logout)
 */
export const revokeUserRefreshTokens = async (userId: number, sessionId?: string): Promise<void> => {
  if (sessionId) {
    await prisma.refreshToken.updateMany({
      where: { userId, sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } else {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
};

/**
 * Очистка refresh cookie
 */
export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH });
};

/**
 * @deprecated Используйте generateTokens() вместо generateToken()
 * Оставлен для обратной совместимости, но использует 15m access + refresh
 */
export const generateToken = async (userId: string | number, res: Response): Promise<{ token: string; sessionId: string }> => {
  const sessionId = uuidv4();
  const accessToken = generateAccessToken(userId, sessionId);
  setAccessTokenCookie(accessToken, res);
  await generateAndStoreRefreshToken(Number(userId), sessionId, res);
  return { token: accessToken, sessionId };
};
