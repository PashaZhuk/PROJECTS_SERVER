import { prisma } from '../config/db.js';

export interface EquipmentInput {
  category: string;
  name: string;
  accountingType?: string;
  purpose?: string;
  serialNumber?: string;
  macAddress?: string;
  issueDate?: string;
  issuedTo?: string;
  issuedToWhere?: string;
  status?: string;
  comments?: string;
}

export interface EquipmentFilter {
  category?: string;
  status?: string;
  search?: string;
  page?: number;
  perPage?: number;
}

export async function getEquipmentList(params: EquipmentFilter = {}) {
  const page = Math.max(1, params.page || 1);
  const perPage = Math.min(100, Math.max(1, params.perPage || 50));
  const skip = (page - 1) * perPage;

  const where: any = {};
  if (params.category) where.category = params.category;
  if (params.status) where.status = params.status;
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { serialNumber: { contains: params.search, mode: 'insensitive' } },
      { macAddress: { contains: params.search, mode: 'insensitive' } },
      { issuedTo: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.testEquipment.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      skip,
      take: perPage,
    }),
    prisma.testEquipment.count({ where }),
  ]);

  return { items, total, page, perPage };
}

export async function getEquipmentById(id: number) {
  return prisma.testEquipment.findUnique({ where: { id } });
}

export async function createEquipment(data: EquipmentInput) {
  return prisma.testEquipment.create({
    data: {
      category: data.category,
      name: data.name,
      accountingType: data.accountingType || null,
      purpose: data.purpose || null,
      serialNumber: data.serialNumber || null,
      macAddress: data.macAddress || null,
      issueDate: data.issueDate || null,
      issuedTo: data.issuedTo || null,
      issuedToWhere: data.issuedToWhere || null,
      status: data.status || 'in_stock',
      comments: data.comments || null,
    },
  });
}

export async function updateEquipment(id: number, data: Partial<EquipmentInput>) {
  return prisma.testEquipment.update({ where: { id }, data });
}

export async function deleteEquipment(id: number) {
  return prisma.testEquipment.delete({ where: { id } });
}

export async function getEquipmentCategories() {
  const result = await prisma.testEquipment.findMany({
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return result.map(r => r.category);
}
