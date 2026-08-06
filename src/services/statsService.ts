import { prisma } from '../config/db.js';
import logger from '../utils/logger.js';
import type { Server } from 'socket.io';

let globalIo: Server | null = null;

export const setIo = (io: Server) => {
  globalIo = io;
  logger.info('✅ Socket.IO instance saved globally');
};

export const getIo = () => globalIo;

// B8: Map<userId, { role, displayName, socketIds: Set<string> }> —
// поддерживается при connect/disconnect, вместо итерации по всем сокетам.
interface OnlineUserEntry {
  role: string;
  displayName: string;
  socketIds: Set<string>;
}

const onlineUsersMap = new Map<number, OnlineUserEntry>();

/** Зарегистрировать сокет при подключении */
export const registerSocket = (socketId: string, userId: number, role: string, displayName: string) => {
  let entry = onlineUsersMap.get(userId);
  if (!entry) {
    entry = { role, displayName, socketIds: new Set<string>() };
    onlineUsersMap.set(userId, entry);
  }
  entry.socketIds.add(socketId);
};

/** Разрегистрировать сокет при отключении */
export const unregisterSocket = (socketId: string, userId: number) => {
  const entry = onlineUsersMap.get(userId);
  if (!entry) return;
  entry.socketIds.delete(socketId);
  if (entry.socketIds.size === 0) {
    onlineUsersMap.delete(userId);
  }
};

/** Получить Set всех онлайн user IDs (для проверки isOnline в списках пользователей) */
export const getOnlineUserIds = (): Set<number> => {
  const ids = new Set<number>();
  for (const [userId] of onlineUsersMap) {
    ids.add(userId);
  }
  return ids;
};

/** Очистить Map онлайн-пользователей (для тестов) */
export const clearOnlineUsersMap = (): void => {
  onlineUsersMap.clear();
};

export const getOnlineUsersFromSockets = () => {
  // B8: читаем из Map вместо forEach по всем сокетам — O(n) по пользователям, а не по сокетам
  const userNames: string[] = [];
  const managerNames: string[] = [];
  let onlineUsers = 0;
  let onlineManagers = 0;

  for (const [, entry] of onlineUsersMap) {
    if (entry.role === 'ADMIN') continue;
    if (entry.role === 'MANAGER') {
      onlineManagers++;
      if (entry.displayName) managerNames.push(entry.displayName);
    } else {
      onlineUsers++;
      if (entry.displayName) userNames.push(entry.displayName);
    }
  }
  return { onlineUsers, onlineManagers, onlineUserNames: userNames, onlineManagerNames: managerNames };
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
  // Защита от моков/неполных объектов в тестах — проверяем наличие to()
  if (!io || typeof io.to !== 'function') return;
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
  // Защита от моков/неполных объектов в тестах — проверяем наличие to()
  if (!io || typeof io.to !== 'function') {
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