import { type Response } from 'express';
import { prisma } from '../config/db.js';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import logger from '../utils/logger';

export const getProjectMessages = asyncHandler(async (req: any, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const project = await prisma.project.findUnique({
    where: { id: parseInt(projectId) },
    select: { partnerId: true }
  });
  if (!project) throw new AppError(404, "Проект не найден");
  if (userRole !== 'MANAGER' && project.partnerId !== userId) {
    logger.warn('Unauthorized chat access attempt', { projectId: parseInt(projectId), userId, ...req.logMeta });
    throw new AppError(403, "У вас нет доступа к переписке");
  }
  const messages = await prisma.message.findMany({
    where: { projectId: parseInt(projectId) },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { id: true, name: true, role: true } } }
  });
  res.json(messages);
});

export const sendMessage = asyncHandler(async (req: any, res: Response) => {
  const { projectId } = req.params;
  const { text } = req.body;
  const senderId = req.user.id;
  const parsedProjectId = parseInt(projectId);
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { text: text.trim(), projectId: parsedProjectId, senderId: senderId },
      include: { sender: { select: { id: true, name: true, role: true } } }
    }),
    prisma.project.update({ where: { id: parsedProjectId }, data: { updatedAt: new Date() } })
  ]);
  const io = req.app.get('io');
  if (io) {
    io.to(`project_${parsedProjectId}`).emit('new_message', message);
  }
  logger.info('Message sent', {
    messageId: message.id,
    projectId: parsedProjectId,
    senderId,
    senderName: message.sender.name,
    textLength: text.length,
    ...req.logMeta
  });
  res.status(201).json(message);
});

export const markAsRead = asyncHandler(async (req: any, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user.id;
  const senders = await prisma.message.findMany({
    where: { projectId: parseInt(projectId), isRead: false, senderId: { not: userId } },
    select: { senderId: true },
    distinct: ['senderId']
  });
  const updateResult = await prisma.message.updateMany({
    where: { projectId: parseInt(projectId), isRead: false, senderId: { not: userId } },
    data: { isRead: true }
  });
  const io = req.app.get('io');
  if (io && updateResult.count > 0) {
    for (const sender of senders) {
      io.to(`user_${sender.senderId}`).emit('messages_read', { projectId: parseInt(projectId), readerId: userId });
    }
    io.to(`project_${projectId}`).emit('messages_read', { projectId: parseInt(projectId), readerId: userId });
    logger.info('Messages marked as read', {
      projectId: parseInt(projectId),
      readerId: userId,
      updatedCount: updateResult.count,
      notifiedSenders: senders.map(s => s.senderId),
      ...req.logMeta
    });
  }
  res.json({ success: true, updatedCount: updateResult.count });
});