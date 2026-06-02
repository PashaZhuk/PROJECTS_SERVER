// src/services/userService.ts
import bcrypt from 'bcrypt';
import { prisma } from '../config/db.js';
import { emitStatsUpdate, emitUserLockStatus, getIo } from './statsService.js';
import { AppError } from '../utils/AppError.js';
import logger from '../utils/logger.js';

export const getUsersList = async (params: {
  page: number;
  limit: number;
  search: string;
  role: string;
}) => {
  const { page, limit, search, role } = params;
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where: any = {
    role: { not: 'ADMIN' },
    ...(role && role !== 'ALL' && { role }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { unp: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };
  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, role: true, companyName: true, unp: true,
        createdAt: true, lastSeen: true, isBlocked: true,
        lockUntil: true, failedLoginAttempts: true,
        twoFactorLockUntil: true, twoFactorAttempts: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.user.count({ where }),
  ]);

  const io = getIo();
  const onlineUserIds = new Set<number>();
  if (io) {
    io.sockets.sockets.forEach((s: any) => {
      if (s.data?.userId) onlineUserIds.add(s.data.userId);
    });
  }
  const usersWithOnlineStatus = users.map(u => ({
    ...u,
    isOnline: onlineUserIds.has(u.id),
    lockUntil: u.lockUntil ? u.lockUntil.toISOString() : null,
    twoFactorLockUntil: u.twoFactorLockUntil ? u.twoFactorLockUntil.toISOString() : null,
  }));
  return { users: usersWithOnlineStatus, totalCount, totalPages: Math.ceil(totalCount / take), currentPage: Number(page) };
};

export const deleteUserById = async (id: number, currentUserId: number, logMeta?: any) => {
  if (id === currentUserId) throw new AppError(400, 'Вы не можете удалить свою собственную учетную запись');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError(404, 'Пользователь не найден');
  await prisma.user.delete({ where: { id } });
  logger.info('User deleted', { targetUserId: user.id, targetEmail: user.email, targetName: user.name, adminId: currentUserId, ...logMeta });
  await emitStatsUpdate();
};

export const toggleBlockUser = async (id: number, currentUserId: number, logMeta?: any) => {
  const targetId = Number(id);
  if (targetId === currentUserId) throw new AppError(400, 'Вы не можете заблокировать себя');
  const user = await prisma.user.findUnique({ where: { id: targetId } });
  if (!user) throw new AppError(404, 'Пользователь не найден');
  if (user.role === 'ADMIN') throw new AppError(400, 'Нельзя заблокировать администратора');

  let newBlockedState = !user.isBlocked;
  let message = '';
  const now = new Date();
  const isLoginLocked = user.lockUntil && user.lockUntil > now;
  const is2FALocked = user.twoFactorLockUntil && user.twoFactorLockUntil > now;

  const io = getIo();

  if (isLoginLocked) {
    await prisma.user.update({ where: { id: targetId }, data: { lockUntil: null, failedLoginAttempts: 0, currentSessionId: null } });
    message = 'Снята блокировка входа (брутфорс пароля)';
    newBlockedState = false;
    logger.info('System login lock removed', { targetUserId: user.id, targetEmail: user.email, targetName: user.name, adminId: currentUserId, ...logMeta });
  } else if (is2FALocked) {
    await prisma.user.update({ where: { id: targetId }, data: { twoFactorLockUntil: null, twoFactorAttempts: 0, currentSessionId: null } });
    message = 'Снята блокировка 2FA (брутфорс SMS)';
    newBlockedState = false;
    logger.info('System 2FA lock removed', { targetUserId: user.id, targetEmail: user.email, targetName: user.name, adminId: currentUserId, ...logMeta });
  } else {
    // Ручная блокировка/разблокировка
    await prisma.user.update({ where: { id: targetId }, data: { isBlocked: newBlockedState, ...(newBlockedState && { currentSessionId: null }) } });
    message = newBlockedState ? 'Пользователь заблокирован вручную' : 'Ручная блокировка снята';
    logger.info('User block status changed', {
      targetUserId: user.id,
      targetEmail: user.email,
      targetName: user.name,
      targetRole: user.role,
      action: newBlockedState ? 'blocked' : 'unblocked',
      adminId: currentUserId,
      ...logMeta,
    });
  }

  if (io) {
    // Отправляем событие в админ-комнату для обновления списка пользователей
    io.to('admin_room').emit('user:blocked_status_changed', {
      userId: targetId,
      isBlocked: newBlockedState,
      wasSystemLock: isLoginLocked || is2FALocked,
    });

    // Если произошла ручная блокировка (не снятие системной блокировки), отправляем пользователю событие 'user_blocked'
    if (!isLoginLocked && !is2FALocked && newBlockedState) {
      io.to(`user_${targetId}`).emit('user_blocked');
    } else if ((isLoginLocked || is2FALocked) && !newBlockedState) {
      // При снятии системной блокировки отправляем пользователю событие 'user_unblocked_by_admin' (опционально)
      io.to(`user_${targetId}`).emit('user_unblocked_by_admin');
    }

    await emitStatsUpdate();
  }

  return { message, isBlocked: newBlockedState };
};

export const changeUserPassword = async (userId: number, newPassword: string, logMeta?: any) => {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  await prisma.user.update({ where: { id: userId }, data: { password: hashedPassword, mustChangePassword: false } });
  logger.info('User changed password', { userId, ...logMeta });
};

export const getAdminStatsService = async () => {
  const { fetchStatsInternal } = await import('./statsService.js');
  return fetchStatsInternal();
};