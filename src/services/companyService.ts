import { prisma } from '../config/db.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const getCompanies = async (search?: string, limit = 100) => {
  const where: Prisma.CompanyWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { unp: { contains: search, mode: 'insensitive' } },
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
