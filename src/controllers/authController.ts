import type { Response, Request } from 'express';
import { prisma } from '../config/db.js';
import bcrypt from 'bcrypt';
import { generateToken } from '../utils/generateToken';
import { emitStatsUpdate, emitUserLockStatus } from './userController';
import { v4 as uuidv4 } from 'uuid';
import { sendEmail, generateResetPasswordEmail, generateWelcomeEmail } from '../services/emailService';

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
    console.error('Failed to send welcome email:', error);
  }
};

const check2FALock = (user: any) => {
  if (user.twoFactorLockUntil && user.twoFactorLockUntil > new Date()) {
    const timeLeft = Math.ceil((user.twoFactorLockUntil.getTime() - Date.now()) / 1000);
    return { locked: true, timeLeft };
  }
  return { locked: false, timeLeft: 0 };
};

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, role, unp, companyName, phone } = req.body;
    const finalName = name ? name.trim() : (companyName ? companyName.trim() : 'Партнер');
    
    const userExist = await prisma.user.findUnique({ where: { email } });
    if (userExist) return res.status(400).json({ error: "Пользователь с таким Email уже существует" });
    if (role === 'ADMIN') return res.status(403).json({ error: "Недостаточно прав для создания администратора" });

    if (role === 'USER') {
      const cleanUnp = unp.toString().trim();
      const cleanCompanyName = companyName.trim();
      const partnerConflict = await prisma.user.findFirst({
        where: { OR: [{ unp: cleanUnp }, { companyName: { equals: cleanCompanyName, mode: 'insensitive' } }] }
      });
      if (partnerConflict) {
        const isUnpMatch = partnerConflict.unp === cleanUnp;
        return res.status(400).json({ error: isUnpMatch ? `Партнер с УНП ${cleanUnp} уже зарегистрирован` : `Компания "${cleanCompanyName}" уже существует` });
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
    res.status(201).json({ status: "success", message: "Пользователь успешно создан", data: { user: { id: user.id, name: user.name, email: user.email, role: user.role, companyName: user.companyName } } });
  } catch (error: any) {
    console.error("Registration Error:", error);
    if (error.code === 'P2002') {
      const meta = error.meta;
      let targetFields: string[] = [];
      if (meta) {
        if (Array.isArray(meta.target)) targetFields = meta.target;
        else if (typeof meta.target === 'string') targetFields = [meta.target];
      }
      const targetString = targetFields.join(',').toLowerCase();
      const errorMessage = error.message?.toLowerCase() || '';
      if (targetFields.includes('phone') || targetString.includes('phone') || errorMessage.includes('phone')) return res.status(400).json({ error: "Этот номер телефона уже зарегистрирован" });
      if (targetFields.includes('email') || targetString.includes('email') || errorMessage.includes('email')) return res.status(400).json({ error: "Пользователь с таким Email уже существует" });
      if (targetFields.includes('unp') || targetString.includes('unp') || errorMessage.includes('unp')) return res.status(400).json({ error: "Партнер с таким УНП уже зарегистрирован" });
      return res.status(400).json({ error: "Данные уже используются в системе" });
    }
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (user && user.lockUntil && user.lockUntil > new Date()) {
      const timeLeft = Math.ceil((user.lockUntil.getTime() - Date.now()) / 1000);
      return res.status(429).json({ error: `Аккаунт заблокирован. Попробуйте через ${timeLeft} сек.`, timeLeft, lockType: 'PASSWORD' });
    }

    if (user && user.twoFactorLockUntil && user.twoFactorLockUntil > new Date()) {
      const timeLeft = Math.ceil((user.twoFactorLockUntil.getTime() - Date.now()) / 1000);
      return res.status(429).json({ error: "Аккаунт заблокирован из-за превышения попыток ввода SMS-кода. Попробуйте позже.", timeLeft, lockType: '2FA' });
    }

    if (!user || !(await bcrypt.compare(password, user.password))) {
      if (user) {
        const newAttempts = (user.failedLoginAttempts || 0) + 1;
        const io = req.app.get('io');
        if (newAttempts >= 5) {
          const lockTime = new Date(Date.now() + 15 * 60 * 1000);
          await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: newAttempts, lockUntil: lockTime } });
          emitUserLockStatus(io, user.id, { lockUntil: lockTime, failedLoginAttempts: newAttempts });
          return res.status(429).json({ error: 'Превышено количество попыток входа. Аккаунт заблокирован на 15 мин.', timeLeft: 900, lockType: 'PASSWORD' });
        }
        await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: newAttempts } });
        emitUserLockStatus(io, user.id, { failedLoginAttempts: newAttempts });
        const attemptsLeft = 5 - newAttempts;
        return res.status(401).json({ error: "Неверный email или пароль", attemptsLeft });
      }
      return res.status(401).json({ error: "Неверный email или пароль" });
    }

    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      const io = req.app.get('io');
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockUntil: null } });
      emitUserLockStatus(io, user.id, { lockUntil: null, failedLoginAttempts: 0 });
    }

    const requires2FA = user.role === 'USER';

    if (requires2FA) {
      res.status(200).json({
        status: "2FA_REQUIRED",
        message: "Требуется подтверждение входа (SMS)",
        data: { userId: user.id, email: user.email, requires2FA: true }
      });
    } else {
      const { token, sessionId } = generateToken(String(user.id), res);
      const io = req.app.get('io');
      if (io && user.currentSessionId && user.currentSessionId !== sessionId) {
        io.to(`user_${user.id}`).emit('session_superseded');
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { currentSessionId: sessionId, lastSeen: new Date(), twoFactorVerified: false }
      });
      emitStatsUpdate(io);
      if (io) io.to('admin_room').emit('user_status_changed', { userId: user.id, lastSeen: new Date() });
      res.status(200).json({
        status: "success",
        data: {
          user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
          token
        }
      });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Ошибка сервера при входе" });
  }
};

export const send2FACode = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    const lockStatus = check2FALock(user);
    if (lockStatus.locked) {
      return res.status(429).json({ error: "Слишком много неудачных попыток. Попробуйте позже.", timeLeft: lockStatus.timeLeft });
    }

    if (user.twoFactorCodeSentAt) {
      const timePassed = Date.now() - user.twoFactorCodeSentAt.getTime();
      if (timePassed < CODE_RESEND_DELAY_MS) {
        const waitTime = Math.ceil((CODE_RESEND_DELAY_MS - timePassed) / 1000);
        return res.status(429).json({ error: `Код можно запросить повторно через ${waitTime} сек.`, timeLeft: waitTime });
      }
    }

    await prisma.user.update({ where: { id: user.id }, data: { twoFactorCodeSentAt: new Date() } });
    console.log(`🔐 2FA CODE for ${user.email}: ${HARDCODED_2FA_CODE}`);
    res.json({ status: "success", message: "Код отправлен (см. консоль сервера)", debugCode: HARDCODED_2FA_CODE });
  } catch (error) {
    console.error("Send 2FA Code Error:", error);
    res.status(500).json({ error: "Ошибка отправки кода" });
  }
};

export const verify2FACode = async (req: Request, res: Response) => {
  try {
    const { userId, code } = req.body;
    const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    const lockStatus = check2FALock(user);
    if (lockStatus.locked) {
      return res.status(429).json({ error: "Аккаунт заблокирован после неудачных попыток.", timeLeft: lockStatus.timeLeft });
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
        return res.status(429).json({ error: "Превышено количество попыток. Аккаунт заблокирован на 15 мин.", timeLeft: 900 });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorAttempts: newAttempts }
      });
      emitUserLockStatus(io, user.id, { twoFactorAttempts: newAttempts });
      const attemptsLeft = MAX_2FA_ATTEMPTS - newAttempts;
      return res.status(401).json({ error: "Неверный код", attemptsLeft });
    }

    // Успешная верификация
    const io = req.app.get('io');
    const { token, sessionId } = generateToken(String(user.id), res);
    if (io && user.currentSessionId && user.currentSessionId !== sessionId) {
      io.to(`user_${user.id}`).emit('session_superseded');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { currentSessionId: sessionId, twoFactorAttempts: 0, twoFactorLockUntil: null, twoFactorVerified: true, lastSeen: new Date() }
    });
    emitUserLockStatus(io, user.id, { twoFactorLockUntil: null, twoFactorAttempts: 0 });
    emitStatsUpdate(io);
    if (io) io.to('admin_room').emit('user_status_changed', { userId: user.id, lastSeen: new Date() });

    res.json({
      status: "success",
      message: "2FA успешно пройдена",
      data: {
        user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
        token
      }
    });
  } catch (error) {
    console.error("Verify 2FA Error:", error);
    res.status(500).json({ error: "Ошибка проверки кода" });
  }
};

export const logout = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const io = req.app.get('io');
    if (userId) {
      const oldDate = new Date(Date.now() - 10 * 60 * 1000);
      await prisma.user.update({ where: { id: userId }, data: { lastSeen: oldDate, currentSessionId: null, twoFactorVerified: false } });
      if (io) { io.to('admin_room').emit('user_status_changed', { userId, lastSeen: oldDate }); emitStatsUpdate(io); }
    }
    res.clearCookie('jwt', { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
    return res.status(200).json({ status: "success" });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: "Logout failed" });
  }
};

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(404).json({ error: "User not found" });
    const { password, ...userData } = user;
    res.status(200).json({ status: "success", data: userData });
  } catch (error) {
    console.error("Get Profile Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ status: "success", message: "Если такой пользователь существует, письмо отправлено." });
    const resetToken = uuidv4();
    const resetTokenExpiry = new Date(Date.now() + 3600000);
    await prisma.user.update({ where: { id: user.id }, data: { resetPasswordToken: resetToken, resetPasswordExpires: resetTokenExpiry } });
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const resetLink = `${clientUrl}/reset-password?token=${resetToken}`;
    const html = generateResetPasswordEmail(resetLink);
    await sendEmail({ to: user.email, subject: 'Сброс пароля IPMATICA Hub', html });
    res.json({ status: "success", message: "Письмо со ссылкой для сброса пароля отправлено." });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ error: "Ошибка сервера при отправке письма" });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;
    const user = await prisma.user.findFirst({ where: { resetPasswordToken: token, resetPasswordExpires: { gte: new Date() } } });
    if (!user) return res.status(400).json({ error: "Ссылка недействительна или срок её действия истек" });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword, resetPasswordToken: null, resetPasswordExpires: null, mustChangePassword: false } });
    res.json({ status: "success", message: "Пароль успешно изменен" });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ error: "Ошибка сервера при смене пароля" });
  }
};