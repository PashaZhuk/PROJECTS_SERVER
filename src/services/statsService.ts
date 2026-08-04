import { prisma } from '../config/db.js';
import logger from '../utils/logger.js';
import type { Server, Socket } from 'socket.io';

let globalIo: Server | null = null;

export const setIo = (io: Server) => {
  globalIo = io;
  logger.info('✅ Socket.IO instance saved globally');
};

export const getIo = () => globalIo;

export const getOnlineUsersFromSockets = () => {
  const io = getIo();
  if (!io) return { onlineUsers: 0, onlineManagers: 0, onlineUserNames: [] as string[], onlineManagerNames: [] as string[] };
  const uniqueUsers = new Set<number>();
  const uniqueManagers = new Set<number>();
  const userNames: string[] = [];
  const managerNames: string[] = [];
  const sockets = io.sockets.sockets;
  sockets.forEach((socket: Socket) => {
    const userId = socket.data?.userId;
    const userRole = socket.data?.userRole;
    const displayName = socket.data?.user?.companyName || socket.data?.user?.name || '';
    if (userId) {
      if (userRole === 'ADMIN') return;
      if (userRole === 'MANAGER') {
        if (!uniqueManagers.has(userId)) {
          uniqueManagers.add(userId);
          if (displayName) managerNames.push(displayName);
        }
      } else if (userRole === 'USER') {
        if (!uniqueUsers.has(userId)) {
          uniqueUsers.add(userId);
          if (displayName) userNames.push(displayName);
        }
      }
    }
  });
  return { onlineUsers: uniqueUsers.size, onlineManagers: uniqueManagers.size, onlineUserNames: userNames, onlineManagerNames: managerNames };
};

export const fetchStatsInternal = async () => {
  const [totalUsers, totalManagers, allUsers, allManagers] = await Promise.all([
    prisma.user.count({ where: { role: 'USER' } }),
    prisma.user.count({ where: { role: 'MANAGER' } }),
    prisma.user.findMany({ where: { role: 'USER' }, select: { name: true, companyName: true, email: true } }),
    prisma.user.findMany({ where: { role: 'MANAGER' }, select: { name: true, email: true } }),
  ]);
  const { onlineUsers, onlineManagers, onlineUserNames, onlineManagerNames } = getOnlineUsersFromSockets();
  return {
    totalUsers,
    totalManagers,
    totalUserNames: allUsers.map(u => u.companyName || u.name || u.email),
    totalManagerNames: allManagers.map(m => m.name || m.email),
    onlineCount: onlineUsers + onlineManagers,
    details: { onlineUsers, onlineManagers, onlineUserNames, onlineManagerNames },
  };
};

export const emitStatsUpdate = async () => {
  const io = getIo();
  if (!io) return;
  try {
    const stats = await fetchStatsInternal();
    io.to('admin_room').emit('stats_updated', stats);
  } catch (error) {
    logger.error('Socket Emit Stats Error:', error);
  }
};

export const emitUserLockStatus = (
  userId: number,
  updates: {
    lockUntil?: Date | null;
    failedLoginAttempts?: number;
    twoFactorLockUntil?: Date | null;
    twoFactorAttempts?: number;
    isBlocked?: boolean;
  }
) => {
  const io = getIo();
  if (!io) {
    logger.warn('⚠️ emitUserLockStatus: io not set, skipping');
    return;
  }
  logger.info('📢 emitUserLockStatus called', { userId, updates });
  io.to('admin_room').emit('user:blocked_status_changed', {
    userId,
    ...updates,
    lockUntil: updates.lockUntil ? updates.lockUntil.toISOString() : null,
    twoFactorLockUntil: updates.twoFactorLockUntil ? updates.twoFactorLockUntil.toISOString() : null,
  });
};