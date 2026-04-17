import type { Response, Request } from 'express';
import { prisma } from '../config/db.js';
import bcrypt from 'bcrypt';

let ioInstance: any = null;

export const setIoInstance = (io: any) => { 
  ioInstance = io; 
};

interface AuthRequest extends Request {
  user?: any;
}

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

const getUsers = async (req: any, res: Response) => {
  try {
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
          // Блокировка входа
          lockUntil: true,
          failedLoginAttempts: true,
          // 🔥 НОВОЕ: Блокировка 2FA
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

    res.status(200).json({
      status: 'success',
      users: usersWithOnlineStatus,
      totalCount,
      totalPages: Math.ceil(totalCount / take),
      currentPage: Number(page)
    });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ status: 'error', message: 'Не удалось получить список пользователей' });
  }
};

const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (Number(id) === (req as any).user.id) {
      return res.status(400).json({ error: "Вы не можете удалить свою собственную учетную запись" });
    }
    const user = await prisma.user.findUnique({ where: { id: Number(id) } });
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    await prisma.user.delete({ where: { id: Number(id) } });
    emitStatsUpdate(req.app.get('io'));

    res.status(200).json({ status: "success", message: "Пользователь успешно удален" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Ошибка сервера при удалении" });
  }
};

const toggleBlock = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const targetId = Number(id);
    if (targetId === (req as any).user.id) {
      return res.status(400).json({ error: "Вы не можете заблокировать себя" });
    }

    const user = await prisma.user.findUnique({ where: { id: targetId } });
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    if (user.role === 'ADMIN') return res.status(400).json({ error: "Нельзя заблокировать администратора" });

    let newBlockedState = !user.isBlocked;
    let message = '';
    const now = new Date();

    // 🔥 ПРИОРИТЕТ РАЗБЛОКИРОВКИ:
    // 1. Снимаем блокировку входа (Пароль)
    // 2. Снимаем блокировку 2FA (SMS)
    // 3. Переключаем ручную блокировку

    const isLoginLocked = user.lockUntil && user.lockUntil > now;
    const is2FALocked = user.twoFactorLockUntil && user.twoFactorLockUntil > now;

    if (isLoginLocked) {
      await prisma.user.update({
        where: { id: targetId },
        data: {
          lockUntil: null,
          failedLoginAttempts: 0,
          currentSessionId: null
        }
      });
      message = 'Снята блокировка входа (брутфорс пароля)';
      newBlockedState = false;
    } else if (is2FALocked) {
      await prisma.user.update({
        where: { id: targetId },
        data: {
          twoFactorLockUntil: null,
          twoFactorAttempts: 0,
          currentSessionId: null
        }
      });
      message = 'Снята блокировка 2FA (брутфорс SMS)';
      newBlockedState = false;
    } else {
      // Ручная блокировка
      await prisma.user.update({
        where: { id: targetId },
        data: {
          isBlocked: newBlockedState,
          ...(newBlockedState && { currentSessionId: null })
        }
      });
      message = newBlockedState ? 'Пользователь заблокирован вручную' : 'Ручная блокировка снята';
    }

    const io = req.app.get('io');
    if (io) {
      if (isLoginLocked || is2FALocked) {
         io.to(`user_${targetId}`).emit('user_unblocked_by_admin');
      } else if (!isLoginLocked && !is2FALocked && newBlockedState) {
         io.to(`user_${targetId}`).emit('user_blocked');
      }
      
      io.to('admin_room').emit('user:blocked_status_changed', {
        userId: targetId,
        isBlocked: newBlockedState,
        wasSystemLock: isLoginLocked || is2FALocked
      });

      await emitStatsUpdate(io); 
    }

    res.status(200).json({
      status: 'success',
      message,
      isBlocked: newBlockedState
    });
  } catch (error) {
    console.error('Toggle block error:', error);
    res.status(500).json({ error: "Ошибка при изменении статуса блокировки" });
  }
};

const changeDefaultPassword = async (req: AuthRequest, res: Response) => {
  try {
    const { newPassword } = req.body;
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword, mustChangePassword: false }
    });
    res.json({ status: "success" });
  } catch (error) {
    res.status(500).json({ error: "Ошибка при смене пароля" });
  }
};

const getAdminStats = async (req: Request, res: Response) => {
  try {
    const stats = await fetchStatsInternal();
    res.status(200).json(stats);
  } catch (error) {
    console.error('Admin Stats Error:', error);
    res.status(500).json({ status: 'error', message: 'Не удалось собрать статистику' });
  }
};

export { getUsers, deleteUser, changeDefaultPassword, getAdminStats, toggleBlock };