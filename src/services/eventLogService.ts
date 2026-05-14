import { prisma } from '../config/db.js';

export async function getEventLog(limit = 100) {
  return prisma.eventLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: { select: { name: true, companyName: true, email: true } },
    },
  });
}

export async function logEvent(data: {
  action: string; description: string; entityType?: string; entityId?: number; userId?: number;
}) {
  // Не блокируем основной поток — fire-and-forget
  prisma.eventLog.create({ data }).catch(() => {});
}
