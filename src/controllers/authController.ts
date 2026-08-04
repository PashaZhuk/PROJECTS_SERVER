import type { Response } from 'express';
import {
  registerUser,
  loginUser,
  send2FACodeService,
  verify2FACodeService,
  logoutUser,
  forgotPasswordService,
  resetPasswordService,
  changePasswordService,
} from '../services/authService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { rotateRefreshToken, clearRefreshCookie, verifyPreAuthToken, clearPreAuthCookie } from '../utils/generateToken.js';
import { sendSuccess, sendError } from '../utils/response.js';
import type { AuthRequest } from '../types/express.js';

export const register = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await registerUser(req.body, req.logMeta);
  sendSuccess(res, { user: { id: user.id, name: user.name, email: user.email, role: user.role, companyName: user.companyName, unp: user.unp } }, 'Пользователь успешно создан', 201);
});

export const login = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email, password } = req.body;
  const result = await loginUser(email, password, res, req.logMeta);
  if (!result.success) {
    if (result.userBlocked) return sendError(res, 403, 'Ваш аккаунт заблокирован', { code: 'USER_BLOCKED' });
    if (result.lockType === 'password') return sendError(res, 429, 'Аккаунт заблокирован из-за частых ошибок', { timeLeft: result.timeLeft, lockType: 'password' });
    if (result.lockType === '2FA') return sendError(res, 429, 'Аккаунт заблокирован из-за ошибок 2FA', { timeLeft: result.timeLeft, lockType: '2FA' });
    if (result.requires2FA) return res.status(200).json({ success: true, status: '2FA_REQUIRED', message: 'Требуется подтверждение входа (SMS)', data: { email: result.email, requires2FA: true } });
    if (result.attemptsLeft !== undefined) return sendError(res, 401, 'Неверный email или пароль', { attemptsLeft: result.attemptsLeft });
    return sendError(res, 401, 'Неверный email или пароль');
  }
  sendSuccess(res, { user: result.user });
});

export const send2FACode = asyncHandler(async (req: AuthRequest, res: Response) => {
  // B4: userId читаем из preauth cookie, а не из тела запроса
  const preauth = verifyPreAuthToken(req.cookies?.preauth);
  if (!preauth) {
    return sendError(res, 401, 'Сессия 2FA истекла. Начните вход заново.', { code: 'PREAUTH_EXPIRED' });
  }
  const result = await send2FACodeService(preauth.userId, req.logMeta);
  // debugCode приходит только в dev-режиме (B1). В проде контроллер не отдаёт код клиенту.
  if (result.debugCode) {
    sendSuccess(res, { debugCode: result.debugCode }, 'Код отправлен (см. консоль сервера)');
  } else {
    sendSuccess(res, undefined, 'Код отправлен');
  }
});

export const verify2FACode = asyncHandler(async (req: AuthRequest, res: Response) => {
  // B4: userId читаем из preauth cookie, а не из тела запроса
  const preauth = verifyPreAuthToken(req.cookies?.preauth);
  if (!preauth) {
    clearPreAuthCookie(res);
    return sendError(res, 401, 'Сессия 2FA истекла. Начните вход заново.', { code: 'PREAUTH_EXPIRED' });
  }
  const { code } = req.body;
  const result = await verify2FACodeService(preauth.userId, code, res, req.logMeta);
  if (!result.success) {
    if (result.locked) {
      clearPreAuthCookie(res);
      return sendError(res, 429, 'Аккаунт заблокирован после неудачных попыток.', { timeLeft: result.timeLeft, lockType: '2FA' });
    }
    if (result.attemptsLeft !== undefined) return sendError(res, 401, 'Неверный код', { attemptsLeft: result.attemptsLeft });
    return sendError(res, 401, 'Неверный код');
  }
  sendSuccess(res, { user: result.user }, '2FA успешно пройдена');
});

export const logout = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  await logoutUser(userId, res, req.logMeta);
  res.clearCookie('jwt', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
  sendSuccess(res);
});

export const getProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (!user) throw new AppError(404, 'User not found');
  const { password, ...userData } = user;
  sendSuccess(res, userData);
});

export const forgotPassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email } = req.body;
  await forgotPasswordService(email, req.logMeta);
  sendSuccess(res, undefined, 'Если такой пользователь существует, письмо отправлено.');
});

export const resetPassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { token, newPassword } = req.body;
  await resetPasswordService(token, newPassword, req.logMeta);
  sendSuccess(res, undefined, 'Пароль успешно изменен');
});

export const refresh = asyncHandler(async (req: AuthRequest, res: Response) => {
  const rawToken = req.cookies?.refreshToken;
  const result = await rotateRefreshToken(rawToken, res);

  if (!result.success) {
    res.clearCookie('jwt', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
    return res.status(401).json({ success: false, error: result.error });
  }

  sendSuccess(res, {
    user: result.user,
    token: result.accessToken,
  });
});

export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user?.id;
  if (!userId) throw new AppError(401, 'Не авторизован');
  await changePasswordService(userId, currentPassword, newPassword, req.logMeta);
  sendSuccess(res, undefined, 'Пароль успешно изменен');
});
