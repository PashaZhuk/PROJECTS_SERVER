import type { Response, Request } from 'express';
import { prisma } from '../config/db.js';
import bcrypt from 'bcrypt';

interface AuthRequest extends Request {
    user?: any;
}

export const fetchStatsInternal = async () => {
    const activeThreshold = new Date(Date.now() - 5 * 60 * 1000);

    const [totalUsers, totalManagers, onlineUsers, onlineManagers] = await Promise.all([
        prisma.user.count({ where: { role: 'USER' } }),
        prisma.user.count({ where: { role: 'MANAGER' } }),
        prisma.user.count({
            where: { role: 'USER', lastSeen: { gte: activeThreshold } }
        }),
        prisma.user.count({
            where: { role: 'MANAGER', lastSeen: { gte: activeThreshold } }
        })
    ]);

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
                    isBlocked: true, // ← добавили
                },
                orderBy: { createdAt: 'desc' },
                take,
                skip,
            }),
            prisma.user.count({ where }),
        ]);

        res.status(200).json({
            status: 'success',
            users,
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

        if (user.role === 'ADMIN') {
            return res.status(400).json({ error: "Нельзя заблокировать администратора" });
        }

        const newBlockedState = !user.isBlocked;

        const updatedUser = await prisma.user.update({
            where: { id: targetId },
            data: {
                isBlocked: newBlockedState,
                // Если блокируем — сбрасываем сессию, чтобы пользователь немедленно вылетел
                ...(newBlockedState && { currentSessionId: null })
            }
        });

        const io = req.app.get('io');
        if (io) {
            if (newBlockedState) {
                // Отправляем сигнал в персональную комнату — пользователь получит и увидит модалку
                io.to(`user_${targetId}`).emit('user_blocked');
            }
            
            // Обновляем список у админа через сокет
            io.to('admin_room').emit('user:blocked_status_changed', {
                userId: targetId,
                isBlocked: newBlockedState
            });

            // --- ДОБАВЛЕНО: Обновляем статистику в реальном времени ---
            // Импортируй emitStatsUpdate из контроллера, если он в другом файле
            await emitStatsUpdate(io); 
        }

        res.status(200).json({
            status: 'success',
            message: newBlockedState ? 'Пользователь заблокирован' : 'Пользователь разблокирован',
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

export const emitUserStatusUpdate = (io: any, userId: number, lastSeen: Date) => {
    if (!io) return;
    io.to('admin_room').emit('user_status_changed', { userId, lastSeen });
};

export { getUsers, deleteUser, changeDefaultPassword, getAdminStats, toggleBlock };