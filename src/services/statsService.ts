import { prisma } from '../config/db.js';

let globalIo: any = null;

export const setIo = (io: any) => {
  globalIo = io;
  console.log('✅ Socket.IO instance saved globally');
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
  sockets.forEach((socket: any) => {
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
  const [totalUsers, totalManagers] = await Promise.all([
    prisma.user.count({ where: { role: 'USER' } }),
    prisma.user.count({ where: { role: 'MANAGER' } }),
  ]);
  const { onlineUsers, onlineManagers } = getOnlineUsersFromSockets();
  return {
    totalUsers,
    totalManagers,
    onlineCount: onlineUsers + onlineManagers,
    details: { onlineUsers, onlineManagers },
  };
};

export const emitStatsUpdate = async () => {
  const io = getIo();
  if (!io) return;
  try {
    const stats = await fetchStatsInternal();
    io.to('admin_room').emit('stats_updated', stats);
  } catch (error) {
    console.error('Socket Emit Stats Error:', error);
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
    console.warn('⚠️ emitUserLockStatus: io not set, skipping');
    return;
  }
  console.log('📢 emitUserLockStatus called', { userId, updates });
  io.to('admin_room').emit('user:blocked_status_changed', {
    userId,
    ...updates,
    lockUntil: updates.lockUntil ? updates.lockUntil.toISOString() : null,
    twoFactorLockUntil: updates.twoFactorLockUntil ? updates.twoFactorLockUntil.toISOString() : null,
  });
};