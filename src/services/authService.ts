import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/db.js';
import { generateToken } from '../utils/generateToken.js';
import { sendEmail, generateResetPasswordEmail, generateWelcomeEmail } from './emailService.js';
import { emitStatsUpdate, emitUserLockStatus, getIo } from './statsService.js';
import { AppError } from '../utils/AppError.js';
import logger from '../utils/logger.js';

const MAX_2FA_ATTEMPTS = 3;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const CODE_RESEND_DELAY_MS = 60 * 1000;
const HARDCODED_2FA_CODE = '111111';

const check2FALock = (user: any) => {
  if (user.twoFactorLockUntil && user.twoFactorLockUntil > new Date()) {
    const timeLeft = Math.ceil((user.twoFactorLockUntil.getTime() - Date.now()) / 1000);
    return { locked: true, timeLeft };
  }
  return { locked: false, timeLeft: 0 };
};

const sendWelcomeEmailToUser = async (email: string, name: string, plainPassword: string) => {
  const loginUrl = process.env.CLIENT_URL || 'http://localhost:5173/login';
  const html = generateWelcomeEmail(name, email, plainPassword, loginUrl);
  await sendEmail({ to: email, subject: 'Добро пожаловать в IPMATICA Hub!', html });
};

export const registerUser = async (
  data: {
    name?: string;
    email: string;
    password: string;
    role?: 'USER' | 'MANAGER';
    unp?: string;
    companyName?: string;
    phone?: string;
  },
  logMeta?: any
) => {
  const { name, email, password, role, unp, companyName, phone } = data;
  const finalName = name ? name.trim() : companyName ? companyName.trim() : 'Партнер';

  const userExist = await prisma.user.findUnique({ where: { email } });
  if (userExist) throw new AppError(400, 'Пользователь с таким Email уже существует');

  if (role === 'USER') {
    const cleanUnp = unp!.toString().trim();
    const cleanCompanyName = companyName!.trim();
    const partnerConflict = await prisma.user.findFirst({
      where: { OR: [{ unp: cleanUnp }, { companyName: { equals: cleanCompanyName, mode: 'insensitive' } }] },
    });
    if (partnerConflict) {
      const isUnpMatch = partnerConflict.unp === cleanUnp;
      throw new AppError(
        400,
        isUnpMatch ? `Партнер с УНП ${cleanUnp} уже зарегистрирован` : `Компания "${cleanCompanyName}" уже существует`
      );
    }
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await prisma.user.create({
    data: {
      name: finalName,
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: role || 'USER',
      phone: role === 'USER' ? (phone || null) : null,
      unp: role === 'USER' ? (unp ? unp.toString().trim() : null) : null,
      companyName: role === 'USER' ? (companyName ? companyName.trim() : null) : null,
      mustChangePassword: true,
      twoFactorVerified: false,
    },
  });

  await sendWelcomeEmailToUser(user.email, user.name, password);
  logger.info('User registered', { userId: user.id, email: user.email, name: user.name, role: user.role, ...logMeta });
  return user;
};

export const loginUser = async (
  email: string,
  password: string,
  res: any,
  logMeta?: any
) => {
  const user = await prisma.user.findUnique({ where: { email } });

  if (user && user.isBlocked) {
    logger.warn('Login blocked (admin block)', { email, userId: user.id, name: user.name, role: user.role, ...logMeta });
    return { success: false, userBlocked: true };
  }

  if (user && user.lockUntil && user.lockUntil > new Date()) {
    const timeLeft = Math.ceil((user.lockUntil.getTime() - Date.now()) / 1000);
    logger.warn('Login blocked (password lock)', { email, userId: user.id, name: user.name, role: user.role, timeLeft, ...logMeta });
    return { success: false, lockType: 'password', timeLeft };
  }

  if (user && user.twoFactorLockUntil && user.twoFactorLockUntil > new Date()) {
    const timeLeft = Math.ceil((user.twoFactorLockUntil.getTime() - Date.now()) / 1000);
    logger.warn('Login blocked (2FA lock)', { email, userId: user.id, name: user.name, role: user.role, timeLeft, ...logMeta });
    return { success: false, lockType: '2FA', timeLeft };
  }

  if (!user || !(await bcrypt.compare(password, user.password))) {
    if (user) {
      const newAttempts = (user.failedLoginAttempts || 0) + 1;
      if (newAttempts >= 5) {
        const lockTime = new Date(Date.now() + 15 * 60 * 1000);
        await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: newAttempts, lockUntil: lockTime } });
        emitUserLockStatus(user.id, { lockUntil: lockTime, failedLoginAttempts: newAttempts });
        logger.warn('Password lock activated', { userId: user.id, email, name: user.name, role: user.role, attempts: newAttempts, ...logMeta });
        return { success: false, lockType: 'password', timeLeft: 15 * 60 };
      }
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: newAttempts } });
      emitUserLockStatus(user.id, { failedLoginAttempts: newAttempts });
      const attemptsLeft = 5 - newAttempts;
      logger.warn('Failed login attempt', { email, userId: user.id, name: user.name, role: user.role, attemptsLeft, ...logMeta });
      return { success: false, attemptsLeft };
    }
    logger.warn('Failed login attempt (user not found)', { email, ...logMeta });
    return { success: false, attemptsLeft: 4 };
  }

  if (user.failedLoginAttempts > 0 || user.lockUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockUntil: null } });
    emitUserLockStatus(user.id, { lockUntil: null, failedLoginAttempts: 0 });
  }

  const requires2FA = user.role === 'USER';
  if (requires2FA) {
    logger.info('2FA required', { userId: user.id, email: user.email, name: user.name, role: user.role, ...logMeta });
    return { success: false, requires2FA: true, userId: user.id, email: user.email };
  }

  const { token, sessionId } = generateToken(String(user.id), res);
  const io = getIo();
  if (io && user.currentSessionId && user.currentSessionId !== sessionId) {
    io.to(`user_${user.id}`).emit('session_superseded');
    logger.info('Session superseded', { userId: user.id, name: user.name, role: user.role, ...logMeta });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { currentSessionId: sessionId, lastSeen: new Date(), twoFactorVerified: false },
  });
  await emitStatsUpdate();
  if (io) io.to('admin_room').emit('user_status_changed', { userId: user.id, lastSeen: new Date() });
  logger.info('User logged in', { userId: user.id, email: user.email, name: user.name, role: user.role, ...logMeta });
  return { success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword }, token };
};

export const send2FACodeService = async (userId: number, logMeta?: any) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'Пользователь не найден');

  const lockStatus = check2FALock(user);
  if (lockStatus.locked) {
    logger.warn('2FA code request blocked (lock)', { userId, email: user.email, name: user.name, timeLeft: lockStatus.timeLeft, ...logMeta });
    throw new AppError(429, `Слишком много неудачных попыток. Попробуйте позже. (${lockStatus.timeLeft} сек.)`);
  }

  if (user.twoFactorCodeSentAt) {
    const timePassed = Date.now() - user.twoFactorCodeSentAt.getTime();
    if (timePassed < CODE_RESEND_DELAY_MS) {
      const waitTime = Math.ceil((CODE_RESEND_DELAY_MS - timePassed) / 1000);
      logger.warn('2FA code request too frequent', { userId, email: user.email, waitTime, ...logMeta });
      throw new AppError(429, `Код можно запросить повторно через ${waitTime} сек.`);
    }
  }

  await prisma.user.update({ where: { id: user.id }, data: { twoFactorCodeSentAt: new Date() } });
  logger.info('2FA code sent', { userId: user.id, email: user.email, name: user.name, ...logMeta });
  console.log(`🔐 2FA CODE for ${user.email}: ${HARDCODED_2FA_CODE}`);
  return { debugCode: HARDCODED_2FA_CODE };
};

export const verify2FACodeService = async (userId: number, code: string, res: any, logMeta?: any) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'Пользователь не найден');

  const lockStatus = check2FALock(user);
  if (lockStatus.locked) {
    return { success: false, locked: true, timeLeft: lockStatus.timeLeft };
  }

  if (code !== HARDCODED_2FA_CODE) {
    const newAttempts = (user.twoFactorAttempts || 0) + 1;
    if (newAttempts >= MAX_2FA_ATTEMPTS) {
      const lockTime = new Date(Date.now() + LOCK_DURATION_MS);
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorAttempts: newAttempts, twoFactorLockUntil: lockTime },
      });
      emitUserLockStatus(user.id, { twoFactorLockUntil: lockTime, twoFactorAttempts: newAttempts });
      logger.warn('2FA lock activated', { userId: user.id, email: user.email, name: user.name, attempts: newAttempts, ...logMeta });
      return { success: false, locked: true, timeLeft: LOCK_DURATION_MS / 1000 };
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorAttempts: newAttempts },
    });
    emitUserLockStatus(user.id, { twoFactorAttempts: newAttempts });
    const attemptsLeft = MAX_2FA_ATTEMPTS - newAttempts;
    logger.warn('Invalid 2FA code', { userId: user.id, email: user.email, name: user.name, attemptsLeft, ...logMeta });
    return { success: false, attemptsLeft };
  }

  const { token, sessionId } = generateToken(String(user.id), res);
  const io = getIo();
  if (io && user.currentSessionId && user.currentSessionId !== sessionId) {
    io.to(`user_${user.id}`).emit('session_superseded');
    logger.info('Session superseded after 2FA', { userId: user.id, name: user.name, role: user.role, ...logMeta });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      currentSessionId: sessionId,
      twoFactorAttempts: 0,
      twoFactorLockUntil: null,
      twoFactorVerified: true,
      lastSeen: new Date(),
    },
  });
  emitUserLockStatus(user.id, { twoFactorLockUntil: null, twoFactorAttempts: 0 });
  await emitStatsUpdate();
  if (io) io.to('admin_room').emit('user_status_changed', { userId: user.id, lastSeen: new Date() });
  logger.info('2FA verification successful', { userId: user.id, email: user.email, name: user.name, role: user.role, ...logMeta });
  return {
    success: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
    token,
  };
};

export const logoutUser = async (userId: number | undefined, logMeta?: any) => {
  if (userId) {
    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.user.update({ where: { id: userId }, data: { lastSeen: oldDate, currentSessionId: null, twoFactorVerified: false } });
    const io = getIo();
    if (io) {
      io.to('admin_room').emit('user_status_changed', { userId, lastSeen: oldDate });
      await emitStatsUpdate();
    }
    logger.info('User logged out', { userId, ...logMeta });
  }
};

export const forgotPasswordService = async (email: string, logMeta?: any) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  const resetToken = uuidv4();
  const resetTokenExpiry = new Date(Date.now() + 3600000);
  await prisma.user.update({
    where: { id: user.id },
    data: { resetPasswordToken: resetToken, resetPasswordExpires: resetTokenExpiry },
  });
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const resetLink = `${clientUrl}/reset-password?token=${resetToken}`;
  const html = generateResetPasswordEmail(resetLink);
  await sendEmail({ to: user.email, subject: 'Сброс пароля IPMATICA Hub', html });
  logger.info('Password reset requested', { userId: user.id, email: user.email, name: user.name, ...logMeta });
};

export const resetPasswordService = async (token: string, newPassword: string, logMeta?: any) => {
  const user = await prisma.user.findFirst({
    where: { resetPasswordToken: token, resetPasswordExpires: { gte: new Date() } },
  });
  if (!user) throw new AppError(400, 'Ссылка недействительна или срок её действия истек');
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword, resetPasswordToken: null, resetPasswordExpires: null, mustChangePassword: false },
  });
  logger.info('Password reset successfully', { userId: user.id, email: user.email, name: user.name, ...logMeta });
};