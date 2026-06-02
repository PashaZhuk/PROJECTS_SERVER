import { prisma } from '../config/db.js';

export async function getBroadcastLog() {
  return prisma.broadcastLog.findMany({ orderBy: { sentAt: 'desc' }, take: 50 });
}

export async function logBroadcast(data: {
  subject: string; message: string; recipients: number; status: string; sentBy?: number;
}) {
  return prisma.broadcastLog.create({ data });
}
