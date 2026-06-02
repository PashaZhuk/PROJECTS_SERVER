import { prisma } from '../config/db.js';

export async function getEventLog(params: { page?: number; limit?: number; action?: string } = {}) {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(500, Math.max(1, params.limit || 200));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (params.action) where.action = params.action;

  const [items, total] = await Promise.all([
    prisma.eventLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        user: { select: { name: true, companyName: true, email: true } },
      },
    }),
    prisma.eventLog.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function logEvent(data: {
  action: string; description: string; entityType?: string; entityId?: number; userId?: number;
}) {
  // Не блокируем основной поток — fire-and-forget
  prisma.eventLog.create({ data }).catch(() => {});
}
