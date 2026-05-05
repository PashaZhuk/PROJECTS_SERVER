import type { Response, Request } from 'express';
import { prisma } from '../config/db.js';
import bcrypt from 'bcrypt';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

let ioInstance: any = null;
export const setIoInstance = (io: any) => { ioInstance = io; };

const getOnlineUsersFromSockets = () => {
  if (!ioInstance) return { onlineUsers: 0, onlineManagers: 0 };
  const uniqueUsers = new Set<number>();
  const uniqueManagers = new Set<number>();
  const sockets = ioInstance.sockets.sockets;
  sockets.forEach((socket: any) => {
    const userId = socket.data?.userId;
    const userRole = socket.data?.userRole;
    if (userId) {
      if (userRole === 'ADMIN') return;
      if (userRole === 'MANAGER') uniqueManagers.add(userId);
      else if (userRole === 'USER') uniqueUsers.add(userId);
    }
  });
  return { onlineUsers: uniqueUsers.size, onlineManagers: uniqueManagers.size };
};

export const fetchStatsInternal = async () => {
  const [totalUsers, totalManagers] = await Promise.all([
    prisma.user.count({ where: { role: 'USER' } }),
    prisma.user.count({ where: { role: 'MANAGER' } }),
  ]);
  const { onlineUsers, onlineManagers } = getOnlineUsersFromSockets();
  return {
    totalUsers,
    totalManagers,
    onlineCount: onlineUsers + onlineManagers,
    details: { onlineUsers, onlineManagers }
  };
};

export const emitStatsUpdate = async (io: any) => {
  if (!io) return;
  try {
    const stats = await fetchStatsInternal();
    io.to('admin_room').emit('stats_updated', stats);
  } catch (error) {
    console.error('Socket Emit Stats Error:', error);
  }
};

export const getUsers = asyncHandler(async (req: any, res: Response) => {
  const { page = 1, limit = 10, search = '', role = '' } = req.query;
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
        id: true,
        name: true,
        email: true,
        role: true,
        companyName: true,
        unp: true,
        createdAt: true,
        lastSeen: true,
        isBlocked: true,
        lockUntil: true,
        failedLoginAttempts: true,
        twoFactorLockUntil: true,
        twoFactorAttempts: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.user.count({ where }),
  ]);
  const onlineUserIds = new Set<number>();
  if (ioInstance) {
    ioInstance.sockets.sockets.forEach((s: any) => {
      if (s.data?.userId) onlineUserIds.add(s.data.userId);
    });
  }
  const usersWithOnlineStatus = users.map(u => ({
    ...u,
    isOnline: onlineUserIds.has(u.id),
    lockUntil: u.lockUntil ? u.lockUntil.toISOString() : null,
    twoFactorLockUntil: u.twoFactorLockUntil ? u.twoFactorLockUntil.toISOString() : null,
  }));
  res.status(200).json({ status: 'success', users: usersWithOnlineStatus, totalCount, totalPages: Math.ceil(totalCount / take), currentPage: Number(page) });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (Number(id) === (req as any).user.id) {
    throw new AppError(400, "Вы не можете удалить свою собственную учетную запись");
  }
  const user = await prisma.user.findUnique({ where: { id: Number(id) } });
  if (!user) throw new AppError(404, "Пользователь не найден");
  await prisma.user.delete({ where: { id: Number(id) } });
  emitStatsUpdate(req.app.get('io'));
  res.status(200).json({ status: "success", message: "Пользователь успешно удален" });
});

export const toggleBlock = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const targetId = Number(id);
  if (targetId === (req as any).user.id) {
    throw new AppError(400, "Вы не можете заблокировать себя");
  }
  const user = await prisma.user.findUnique({ where: { id: targetId } });
  if (!user) throw new AppError(404, "Пользователь не найден");
  if (user.role === 'ADMIN') throw new AppError(400, "Нельзя заблокировать администратора");

  let newBlockedState = !user.isBlocked;
  let message = '';
  const now = new Date();
  const isLoginLocked = user.lockUntil && user.lockUntil > now;
  const is2FALocked = user.twoFactorLockUntil && user.twoFactorLockUntil > now;

  if (isLoginLocked) {
    await prisma.user.update({ where: { id: targetId }, data: { lockUntil: null, failedLoginAttempts: 0, currentSessionId: null } });
    message = 'Снята блокировка входа (брутфорс пароля)';
    newBlockedState = false;
  } else if (is2FALocked) {
    await prisma.user.update({ where: { id: targetId }, data: { twoFactorLockUntil: null, twoFactorAttempts: 0, currentSessionId: null } });
    message = 'Снята блокировка 2FA (брутфорс SMS)';
    newBlockedState = false;
  } else {
    await prisma.user.update({ where: { id: targetId }, data: { isBlocked: newBlockedState, ...(newBlockedState && { currentSessionId: null }) } });
    message = newBlockedState ? 'Пользователь заблокирован вручную' : 'Ручная блокировка снята';
  }

  const io = req.app.get('io');
  if (io) {
    if (isLoginLocked || is2FALocked) {
      io.to(`user_${targetId}`).emit('user_unblocked_by_admin');
    } else if (!isLoginLocked && !is2FALocked && newBlockedState) {
      io.to(`user_${targetId}`).emit('user_blocked');
    }
    io.to('admin_room').emit('user:blocked_status_changed', { userId: targetId, isBlocked: newBlockedState, wasSystemLock: isLoginLocked || is2FALocked });
    await emitStatsUpdate(io);
  }
  res.status(200).json({ status: 'success', message, isBlocked: newBlockedState });
});

export const changeDefaultPassword = asyncHandler(async (req: any, res: Response) => {
  const { newPassword } = req.body;
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  await prisma.user.update({ where: { id: req.user.id }, data: { password: hashedPassword, mustChangePassword: false } });
  res.json({ status: "success" });
});

export const getAdminStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await fetchStatsInternal();
  res.status(200).json(stats);
});

export const emitUserLockStatus = (io: any, userId: number, updates: {
  lockUntil?: Date | null;
  failedLoginAttempts?: number;
  twoFactorLockUntil?: Date | null;
  twoFactorAttempts?: number;
  isBlocked?: boolean;
}) => {
  if (!io) return;
  io.to('admin_room').emit('user:blocked_status_changed', {
    userId,
    ...updates,
    lockUntil: updates.lockUntil ? updates.lockUntil.toISOString() : null,
    twoFactorLockUntil: updates.twoFactorLockUntil ? updates.twoFactorLockUntil.toISOString() : null,
  });
};