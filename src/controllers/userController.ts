import type { Response, Request } from 'express';
import { prisma } from '../config/db.js';
import bcrypt from 'bcrypt';

interface AuthRequest extends Request {
    user?: any;
}

/**
 * ВНУТРЕННИЙ ХЕЛПЕР: Сбор статистики
 * Вынесен отдельно, чтобы его могли использовать и API-эндпоинт, и Socket.io
 */
export const fetchStatsInternal = async () => {
    const activeThreshold = new Date(Date.now() - 5 * 60 * 1000);

    const [totalUsers, totalManagers, onlineUsers, onlineManagers] = await Promise.all([
        prisma.user.count({ where: { role: 'USER' } }),
        prisma.user.count({ where: { role: 'MANAGER' } }),
        prisma.user.count({
            where: {
                role: 'USER',
                lastSeen: { gte: activeThreshold }
            }
        }),
        prisma.user.count({
            where: {
                role: 'MANAGER',
                lastSeen: { gte: activeThreshold }
            }
        })
    ]);

    return {
        totalUsers,
        totalManagers,
        onlineCount: onlineUsers + onlineManagers,
        details: {
            onlineUsers,
            onlineManagers
        }
    };
};

/**
 * ХЕЛПЕР: Рассылка статистики через Socket.io
 */
export const emitStatsUpdate = async (io: any) => {
    if (!io) return;
    try {
        const stats = await fetchStatsInternal();
        // Отправляем данные в комнату админов
        io.to('admin_room').emit('stats_updated', stats);
    } catch (error) {
        console.error('Socket Emit Stats Error:', error);
    }
};

// --- КОНТРОЛЛЕРЫ ---

const getUsers = async (req: any, res: Response) => {
    try {
        // 1. Получаем параметры из строки запроса
        const { page = 1, limit = 10, search = '', role = '' } = req.query;

        // Расчеты для пагинации
        const take = Number(limit);
        const skip = (Number(page) - 1) * take;

        // 2. Формируем условия фильтрации (WHERE)
        const where: any = {
            // Если роль передана и она не 'ALL', фильтруем по ней
            ...(role && role !== 'ALL' && { role }),
            // Если есть поисковый запрос
            ...(search && {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                    { companyName: { contains: search, mode: 'insensitive' } },
                    { unp: { contains: search, mode: 'insensitive' } },
                ],
            }),
        };

        // 3. Выполняем запросы параллельно: сами данные и общее количество
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
                },
                orderBy: { createdAt: 'desc' },
                take: take,
                skip: skip,
            }),
            prisma.user.count({ where }),
        ]);

        // 4. Отдаем ответ в формате, который теперь поймет фронтенд
        res.status(200).json({
            status: 'success',
            users, // Сами данные
            totalCount, // Общее кол-во (для пагинации)
            totalPages: Math.ceil(totalCount / take), // Всего страниц
            currentPage: Number(page)
        });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Не удалось получить список пользователей',
        });
    }
};

const deleteUser = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        if (Number(id) === (req as any).user.id) {
            return res.status(400).json({ error: "Вы не можете удалить свою собственную учетную запись" });
        }

        const user = await prisma.user.findUnique({ where: { id: Number(id) } });
        if (!user) {
            return res.status(404).json({ error: "Пользователь не найден" });
        }

        await prisma.user.delete({ where: { id: Number(id) } });

        // ОБНОВЛЕНИЕ СОКЕТОВ: Рассылаем статистику, так как кол-во пользователей изменилось
        emitStatsUpdate(req.app.get('io'));

        res.status(200).json({
            status: "success",
            message: "Пользователь успешно удален"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Ошибка сервера при удалении" });
    }
};

const changeDefaultPassword = async (req: AuthRequest, res: Response) => {
    try {
        const { newPassword } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await prisma.user.update({
            where: { id: req.user.id },
            data: { 
                password: hashedPassword, 
                mustChangePassword: false 
            }
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

// Хелпер для уведомления админов о том, что статус пользователя изменился
export const emitUserStatusUpdate = (io: any, userId: number, lastSeen: Date) => {
  if (!io) return;
  io.to('admin_room').emit('user_status_changed', { userId, lastSeen });
};


export { getUsers, deleteUser, changeDefaultPassword, getAdminStats };