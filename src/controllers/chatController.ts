import { type Response } from 'express';
import { prisma } from '../config/db.js';

const getProjectMessages = async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const project = await prisma.project.findUnique({
      where: { id: parseInt(projectId) },
      select: { partnerId: true }
    });

    if (!project) {
      return res.status(404).json({ error: "Проект не найден" });
    }

    if (userRole !== 'MANAGER' && project.partnerId !== userId) {
      return res.status(403).json({ error: "У вас нет доступа к переписке" });
    }

    const messages = await prisma.message.findMany({
      where: { projectId: parseInt(projectId) },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: { id: true, name: true, role: true }
        }
      }
    });

    res.json(messages);
  } catch (error) {
    console.error("Chat fetch error:", error);
    res.status(500).json({ error: "Ошибка при получении сообщений" });
  }
};

const sendMessage = async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    const { text } = req.body;
    const senderId = req.user.id;

    const message = await prisma.message.create({
      data: {
        text,
        projectId: parseInt(projectId),
        senderId: senderId
      },
      include: {
        sender: {
          select: { id: true, name: true, role: true }
        }
      }
    });

    // --- ИНТЕГРАЦИЯ SOCKET.IO ---
    const io = req.app.get('io');
    if (io) {
      // Отправляем сообщение в комнату проекта
      io.to(`project_${projectId}`).emit('new_message', message);
      
      // Отправляем уведомление менеджерам и партнеру для обновления бабблов в списке
      io.emit('unread_update', { 
        projectId: parseInt(projectId),
        senderId: senderId 
      });
    }

    res.status(201).json(message);
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({ error: "Ошибка при отправке сообщения" });
  }
};

const markAsRead = async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;

    await prisma.message.updateMany({
      where: {
        projectId: parseInt(projectId),
        isRead: false,
        senderId: { not: userId }
      },
      data: {
        isRead: true
      }
    });

    // --- ИНТЕГРАЦИЯ SOCKET.IO ---
    const io = req.app.get('io');
    if (io) {
      // Сообщаем всем в комнате, что сообщения прочитаны (чтобы обновить галочки)
      io.to(`project_${projectId}`).emit('messages_read', { 
        projectId: parseInt(projectId), 
        readerId: userId 
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ error: "Ошибка при обновлении статуса сообщений" });
  }
};

export { getProjectMessages, sendMessage, markAsRead };