import { prisma } from '../config/db.js'

export const emitStatsUpdate = async (io: any) => {
  if (!io) return;
  try {
    const [usersCount, projectsCount, pendingCount] = await Promise.all([
      prisma.user.count(),
      prisma.project.count(),
      prisma.project.count({ where: { status: 'PENDING' } })
    ]);

    const stats = {
      users: usersCount,
      projects: projectsCount,
      pending: pendingCount,
    };

    io.to('admin_room').emit('stats_updated', stats);
  } catch (e) {
    console.error("Ошибка сокетов:", e);
  }
};