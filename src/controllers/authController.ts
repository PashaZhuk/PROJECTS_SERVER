import type { Response } from 'express';
import {
  registerUser,
  loginUser,
  send2FACodeService,
  verify2FACodeService,
  logoutUser,
  forgotPasswordService,
  resetPasswordService,
} from '../services/authService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { rotateRefreshToken, clearRefreshCookie } from '../utils/generateToken.js';

export const register = asyncHandler(async (req: any, res: Response) => {
  const user = await registerUser(req.body, req.logMeta);
  res.status(201).json({
    status: 'success',
    message: 'Пользователь успешно создан',
    data: { user: { id: user.id, name: user.name, email: user.email, role: user.role, companyName: user.companyName } },
  });
});

export const login = asyncHandler(async (req: any, res: Response) => {
  const { email, password } = req.body;
  const result = await loginUser(email, password, res, req.logMeta);
  if (!result.success) {
    if (result.userBlocked) return res.status(403).json({ error: 'Ваш аккаунт заблокирован', code: 'USER_BLOCKED' });
    if (result.lockType === 'password') return res.status(429).json({ error: 'Аккаунт заблокирован из-за частых ошибок', timeLeft: result.timeLeft, lockType: 'password' });
    if (result.lockType === '2FA') return res.status(429).json({ error: 'Аккаунт заблокирован из-за ошибок 2FA', timeLeft: result.timeLeft, lockType: '2FA' });
    if (result.requires2FA) return res.status(200).json({ status: '2FA_REQUIRED', message: 'Требуется подтверждение входа (SMS)', data: { userId: result.userId, email: result.email, requires2FA: true } });
    if (result.attemptsLeft !== undefined) return res.status(401).json({ error: 'Неверный email или пароль', attemptsLeft: result.attemptsLeft });
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  res.status(200).json({ status: 'success', data: { user: result.user, token: result.token } });
});

export const send2FACode = asyncHandler(async (req: any, res: Response) => {
  const { userId } = req.body;
  const { debugCode } = await send2FACodeService(userId, req.logMeta);
  res.json({ status: 'success', message: 'Код отправлен (см. консоль сервера)', debugCode });
});

export const verify2FACode = asyncHandler(async (req: any, res: Response) => {
  const { userId, code } = req.body;
  const result = await verify2FACodeService(userId, code, res, req.logMeta);
  if (!result.success) {
    if (result.locked) return res.status(429).json({ error: 'Аккаунт заблокирован после неудачных попыток.', timeLeft: result.timeLeft, lockType: '2FA' });
    if (result.attemptsLeft !== undefined) return res.status(401).json({ error: 'Неверный код', attemptsLeft: result.attemptsLeft });
    return res.status(401).json({ error: 'Неверный код' });
  }
  res.json({ status: 'success', message: '2FA успешно пройдена', data: { user: result.user, token: result.token } });
});

export const logout = asyncHandler(async (req: any, res: Response) => {
  const userId = req.user?.id;
  await logoutUser(userId, res, req.logMeta);
  res.clearCookie('jwt', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
  res.status(200).json({ status: 'success' });
});

export const getProfile = asyncHandler(async (req: any, res: Response) => {
  const user = req.user;
  if (!user) throw new AppError(404, 'User not found');
  const { password, ...userData } = user;
  res.status(200).json({ status: 'success', data: userData });
});

export const forgotPassword = asyncHandler(async (req: any, res: Response) => {
  const { email } = req.body;
  await forgotPasswordService(email, req.logMeta);
  res.json({ status: 'success', message: 'Если такой пользователь существует, письмо отправлено.' });
});

export const resetPassword = asyncHandler(async (req: any, res: Response) => {
  const { token, newPassword } = req.body;
  await resetPasswordService(token, newPassword, req.logMeta);
  res.json({ status: 'success', message: 'Пароль успешно изменен' });
});

export const refresh = asyncHandler(async (req: any, res: Response) => {
  const rawToken = req.cookies?.refreshToken;
  const result = await rotateRefreshToken(rawToken, res);

  if (!result.success) {
    res.clearCookie('jwt', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
    return res.status(401).json({ error: result.error });
  }

  res.json({
    status: 'success',
    data: {
      user: result.user,
      token: result.accessToken,
    },
  });
});