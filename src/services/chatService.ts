import { prisma } from '../config/db.js';
import { getIo } from './statsService.js';
import { AppError } from '../utils/AppError.js';
import logger from '../utils/logger.js';

export const getProjectMessages = async (projectId: number, userId: number, userRole: string, logMeta?: any) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { partnerId: true }
  });
  if (!project) throw new AppError(404, 'Проект не найден');
  if (userRole !== 'MANAGER' && project.partnerId !== userId) throw new AppError(403, 'У вас нет доступа к переписке');
  const messages = await prisma.message.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { id: true, name: true, role: true } } }
  });
  return messages;
};

export const sendMessage = async (projectId: number, text: string, senderId: number, logMeta?: any) => {
  const parsedProjectId = Number(projectId);
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { text: text.trim(), projectId: parsedProjectId, senderId },
      include: { sender: { select: { id: true, name: true, role: true } } }
    }),
    prisma.project.update({ where: { id: parsedProjectId }, data: { updatedAt: new Date() } })
  ]);
  const io = getIo();
  if (io) io.to(`project_${parsedProjectId}`).emit('new_message', message);
  logger.info('Message sent', { messageId: message.id, projectId: parsedProjectId, senderId, textLength: text.length, ...logMeta });
  return message;
};

export const markMessagesAsRead = async (projectId: number, userId: number, logMeta?: any) => {
  const senders = await prisma.message.findMany({
    where: { projectId, isRead: false, senderId: { not: userId } },
    select: { senderId: true },
    distinct: ['senderId']
  });
  const updateResult = await prisma.message.updateMany({
    where: { projectId, isRead: false, senderId: { not: userId } },
    data: { isRead: true }
  });
  const io = getIo();
  if (io && updateResult.count > 0) {
    for (const sender of senders) io.to(`user_${sender.senderId}`).emit('messages_read', { projectId, readerId: userId });
    io.to(`project_${projectId}`).emit('messages_read', { projectId, readerId: userId });
    logger.info('Messages marked as read', { projectId, readerId: userId, updatedCount: updateResult.count, notifiedSenders: senders.map(s => s.senderId), ...logMeta });
  }
  return { success: true, updatedCount: updateResult.count };
};