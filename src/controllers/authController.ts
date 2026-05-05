import type { Response, Request } from 'express';
import { prisma } from '../config/db.js';
import bcrypt from 'bcrypt';
import { generateToken } from '../utils/generateToken';
import { emitStatsUpdate, emitUserLockStatus, fetchStatsInternal } from './userController';
import { v4 as uuidv4 } from 'uuid';
import { sendEmail, generateResetPasswordEmail, generateWelcomeEmail } from '../services/emailService';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import logger from '../utils/logger';

interface AuthRequest extends Request {
  user?: any;
}

const MAX_2FA_ATTEMPTS = 3;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const CODE_RESEND_DELAY_MS = 60 * 1000;
const HARDCODED_2FA_CODE = '111111';

const sendWelcomeEmailToUser = async (email: string, name: string, plainPassword: string) => {
  try {
    const loginUrl = process.env.CLIENT_URL || 'http://localhost:5173/login';
    const html = generateWelcomeEmail(name, email, plainPassword, loginUrl);
    await sendEmail({ to: email, subject: 'Добро пожаловать в IPMATICA Hub!', html });
  } catch (error) {
    logger.error('Failed to send welcome email', { email, error });
  }
};

const check2FALock = (user: any) => {
  if (user.twoFactorLockUntil && user.twoFactorLockUntil > new Date()) {
    const timeLeft = Math.ceil((user.twoFactorLockUntil.getTime() - Date.now()) / 1000);
    return { locked: true, timeLeft };
  }
  return { locked: false, timeLeft: 0 };
};

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, role, unp, companyName, phone } = req.body;
  const finalName = name ? name.trim() : (companyName ? companyName.trim() : 'Партнер');

  const userExist = await prisma.user.findUnique({ where: { email } });
  if (userExist) throw new AppError(400, "Пользователь с таким Email уже существует");
  if (role === 'ADMIN') throw new AppError(403, "Недостаточно прав для создания администратора");

  if (role === 'USER') {
    const cleanUnp = unp.toString().trim();
    const cleanCompanyName = companyName.trim();
    const partnerConflict = await prisma.user.findFirst({
      where: { OR: [{ unp: cleanUnp }, { companyName: { equals: cleanCompanyName, mode: 'insensitive' } }] }
    });
    if (partnerConflict) {
      const isUnpMatch = partnerConflict.unp === cleanUnp;
      throw new AppError(400, isUnpMatch ? `Партнер с УНП ${cleanUnp} уже зарегистрирован` : `Компания "${cleanCompanyName}" уже существует`);
    }
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await prisma.user.create({ 
    data: {
      name: finalName, email: email.toLowerCase().trim(), password: hashedPassword,
      role: role || 'USER', phone: role === 'USER' ? phone : null,
      unp: role === 'USER' ? unp.toString().trim() : null,
      companyName: role === 'USER' ? companyName.trim() : null,
      mustChangePassword: true, twoFactorVerified: false
    },
  });
  await sendWelcomeEmailToUser(user.email, user.name, password);
  emitStatsUpdate(req.app.get('io'));
  logger.info('User registered', { userId: user.id, email: user.email, name: user.name, role: user.role, ...req.logMeta });
  res.status(201).json({ status: "success", message: "Пользователь успешно создан", data: { user: { id: user.id, name: user.name, email: user.email, role: user.role, companyName: user.companyName } } });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });

  if (user && user.lockUntil && user.lockUntil > new Date()) {
    const timeLeft = Math.ceil((user.lockUntil.getTime() - Date.now()) / 1000);
    logger.warn('Login blocked (password lock)', { email, userId: user.id, name: user.name, role: user.role, timeLeft, ...req.logMeta });
    throw new AppError(429, `Аккаунт заблокирован. Попробуйте через ${timeLeft} сек.`);
  }

  if (user && user.twoFactorLockUntil && user.twoFactorLockUntil > new Date()) {
    const timeLeft = Math.ceil((user.twoFactorLockUntil.getTime() - Date.now()) / 1000);
    logger.warn('Login blocked (2FA lock)', { email, userId: user.id, name: user.name, role: user.role, timeLeft, ...req.logMeta });
    throw new AppError(429, "Аккаунт заблокирован из-за превышения попыток ввода SMS-кода. Попробуйте позже.");
  }

  if (!user || !(await bcrypt.compare(password, user.password))) {
    if (user) {
      const newAttempts = (user.failedLoginAttempts || 0) + 1;
      const io = req.app.get('io');
      if (newAttempts >= 5) {
        const lockTime = new Date(Date.now() + 15 * 60 * 1000);
        await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: newAttempts, lockUntil: lockTime } });
        emitUserLockStatus(io, user.id, { lockUntil: lockTime, failedLoginAttempts: newAttempts });
        logger.warn('Password lock activated', { userId: user.id, email, name: user.name, role: user.role, attempts: newAttempts, ...req.logMeta });
        throw new AppError(429, 'Превышено количество попыток входа. Аккаунт заблокирован на 15 мин.');
      }
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: newAttempts } });
      emitUserLockStatus(io, user.id, { failedLoginAttempts: newAttempts });
      const attemptsLeft = 5 - newAttempts;
      logger.warn('Failed login attempt', { email, userId: user.id, name: user.name, role: user.role, attemptsLeft, ...req.logMeta });
      res.status(401).json({ error: "Неверный email или пароль", attemptsLeft });
      return;
    }
    logger.warn('Failed login attempt (user not found)', { email, ...req.logMeta });
    res.status(401).json({ error: "Неверный email или пароль" });
    return;
  }

  if (user.failedLoginAttempts > 0 || user.lockUntil) {
    const io = req.app.get('io');
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockUntil: null } });
    emitUserLockStatus(io, user.id, { lockUntil: null, failedLoginAttempts: 0 });
  }

  const requires2FA = user.role === 'USER';
  if (requires2FA) {
    logger.info('2FA required', { userId: user.id, email: user.email, name: user.name, role: user.role, ...req.logMeta });
    res.status(200).json({
      status: "2FA_REQUIRED",
      message: "Требуется подтверждение входа (SMS)",
      data: { userId: user.id, email: user.email, requires2FA: true }
    });
    return;
  }

  // MANAGER / ADMIN
  const { token, sessionId } = generateToken(String(user.id), res);
  const io = req.app.get('io');
  if (io && user.currentSessionId && user.currentSessionId !== sessionId) {
    io.to(`user_${user.id}`).emit('session_superseded');
    logger.info('Session superseded', { userId: user.id, name: user.name, role: user.role, ...req.logMeta });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { currentSessionId: sessionId, lastSeen: new Date(), twoFactorVerified: false }
  });
  emitStatsUpdate(io);
  if (io) io.to('admin_room').emit('user_status_changed', { userId: user.id, lastSeen: new Date() });
  logger.info('User logged in', { userId: user.id, email: user.email, name: user.name, role: user.role, ...req.logMeta });
  res.status(200).json({
    status: "success",
    data: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
      token
    }
  });
});

export const send2FACode = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.body;
  const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
  if (!user) throw new AppError(404, "Пользователь не найден");

  const lockStatus = check2FALock(user);
  if (lockStatus.locked) {
    logger.warn('2FA code request blocked (lock)', { userId, email: user.email, name: user.name, timeLeft: lockStatus.timeLeft, ...req.logMeta });
    throw new AppError(429, `Слишком много неудачных попыток. Попробуйте позже. (${lockStatus.timeLeft} сек.)`);
  }

  if (user.twoFactorCodeSentAt) {
    const timePassed = Date.now() - user.twoFactorCodeSentAt.getTime();
    if (timePassed < CODE_RESEND_DELAY_MS) {
      const waitTime = Math.ceil((CODE_RESEND_DELAY_MS - timePassed) / 1000);
      logger.warn('2FA code request too frequent', { userId, email: user.email, waitTime, ...req.logMeta });
      throw new AppError(429, `Код можно запросить повторно через ${waitTime} сек.`);
    }
  }

  await prisma.user.update({ where: { id: user.id }, data: { twoFactorCodeSentAt: new Date() } });
  logger.info('2FA code sent', { userId: user.id, email: user.email, name: user.name, ...req.logMeta });
  console.log(`🔐 2FA CODE for ${user.email}: ${HARDCODED_2FA_CODE}`);
  res.json({ status: "success", message: "Код отправлен (см. консоль сервера)", debugCode: HARDCODED_2FA_CODE });
});

export const verify2FACode = asyncHandler(async (req: Request, res: Response) => {
  const { userId, code } = req.body;
  const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
  if (!user) throw new AppError(404, "Пользователь не найден");

  const lockStatus = check2FALock(user);
  if (lockStatus.locked) {
    logger.warn('2FA verify blocked (lock)', { userId, email: user.email, name: user.name, timeLeft: lockStatus.timeLeft, ...req.logMeta });
    throw new AppError(429, `Аккаунт заблокирован после неудачных попыток. (${lockStatus.timeLeft} сек.)`);
  }

  if (code !== HARDCODED_2FA_CODE) {
    const newAttempts = (user.twoFactorAttempts || 0) + 1;
    const io = req.app.get('io');
    if (newAttempts >= MAX_2FA_ATTEMPTS) {
      const lockTime = new Date(Date.now() + LOCK_DURATION_MS);
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorAttempts: newAttempts, twoFactorLockUntil: lockTime }
      });
      emitUserLockStatus(io, user.id, { twoFactorLockUntil: lockTime, twoFactorAttempts: newAttempts });
      logger.warn('2FA lock activated', { userId: user.id, email: user.email, name: user.name, attempts: newAttempts, ...req.logMeta });
      throw new AppError(429, "Превышено количество попыток. Аккаунт заблокирован на 15 мин.");
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorAttempts: newAttempts }
    });
    emitUserLockStatus(io, user.id, { twoFactorAttempts: newAttempts });
    const attemptsLeft = MAX_2FA_ATTEMPTS - newAttempts;
    logger.warn('Invalid 2FA code', { userId: user.id, email: user.email, name: user.name, attemptsLeft, ...req.logMeta });
    res.status(401).json({ error: "Неверный код", attemptsLeft });
    return;
  }

  // Успех
  const io = req.app.get('io');
  const { token, sessionId } = generateToken(String(user.id), res);
  if (io && user.currentSessionId && user.currentSessionId !== sessionId) {
    io.to(`user_${user.id}`).emit('session_superseded');
    logger.info('Session superseded after 2FA', { userId: user.id, name: user.name, role: user.role, ...req.logMeta });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { currentSessionId: sessionId, twoFactorAttempts: 0, twoFactorLockUntil: null, twoFactorVerified: true, lastSeen: new Date() }
  });
  emitUserLockStatus(io, user.id, { twoFactorLockUntil: null, twoFactorAttempts: 0 });
  emitStatsUpdate(io);
  if (io) io.to('admin_room').emit('user_status_changed', { userId: user.id, lastSeen: new Date() });
  logger.info('2FA verification successful', { userId: user.id, email: user.email, name: user.name, role: user.role, ...req.logMeta });
  res.json({
    status: "success",
    message: "2FA успешно пройдена",
    data: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
      token
    }
  });
});

export const logout = asyncHandler(async (req: any, res: Response) => {
  const userId = req.user?.id;
  const io = req.app.get('io');
  if (userId) {
    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.user.update({ where: { id: userId }, data: { lastSeen: oldDate, currentSessionId: null, twoFactorVerified: false } });
    if (io) { io.to('admin_room').emit('user_status_changed', { userId, lastSeen: oldDate }); emitStatsUpdate(io); }
    logger.info('User logged out', { userId, name: req.user?.name, email: req.user?.email, ...req.logMeta });
  }
  res.clearCookie('jwt', { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
  res.status(200).json({ status: "success" });
});

export const getProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (!user) throw new AppError(404, "User not found");
  const { password, ...userData } = user;
  res.status(200).json({ status: "success", data: userData });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.json({ status: "success", message: "Если такой пользователь существует, письмо отправлено." });
    return;
  }
  const resetToken = uuidv4();
  const resetTokenExpiry = new Date(Date.now() + 3600000);
  await prisma.user.update({ where: { id: user.id }, data: { resetPasswordToken: resetToken, resetPasswordExpires: resetTokenExpiry } });
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const resetLink = `${clientUrl}/reset-password?token=${resetToken}`;
  const html = generateResetPasswordEmail(resetLink);
  await sendEmail({ to: user.email, subject: 'Сброс пароля IPMATICA Hub', html });
  logger.info('Password reset requested', { userId: user.id, email: user.email, name: user.name, ...req.logMeta });
  res.json({ status: "success", message: "Письмо со ссылкой для сброса пароля отправлено." });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  const user = await prisma.user.findFirst({ where: { resetPasswordToken: token, resetPasswordExpires: { gte: new Date() } } });
  if (!user) throw new AppError(400, "Ссылка недействительна или срок её действия истек");
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword, resetPasswordToken: null, resetPasswordExpires: null, mustChangePassword: false } });
  logger.info('Password reset successfully', { userId: user.id, email: user.email, name: user.name, ...req.logMeta });
  res.json({ status: "success", message: "Пароль успешно изменен" });
});