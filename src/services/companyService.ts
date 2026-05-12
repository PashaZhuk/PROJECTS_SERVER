import { prisma } from '../config/db.js';

export const getCompanies = async (search?: string, limit = 100) => {
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' as any } },
          { unp: { contains: search, mode: 'insensitive' as any } },
        ],
      }
    : {};
  return prisma.company.findMany({
    where,
    take: limit,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, unp: true, phone: true },
  });
};