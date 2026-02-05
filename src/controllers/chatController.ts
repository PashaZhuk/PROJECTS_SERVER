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

    // Проверка доступа
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

    // --- ЗАЩИТА ОТ АБЬЮЗА ---
    // 1. Проверка на наличие текста
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Сообщение не может быть пустым" });
    }

    // 2. Ограничение длины (3000 символов ~ 1.5 листа А4)
    if (text.length > 3000) {
      return res.status(400).json({ error: "Сообщение слишком длинное (макс. 3000 симв.)" });
    }

    // Создаем сообщение и подтягиваем данные отправителя
    const message = await prisma.message.create({
      data: {
        text: text.trim(),
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
      const roomName = `project_${projectId}`;
      
      // Отправляем объект message целиком (с вложенным sender)
      io.to(roomName).emit('new_message', message);
      
      // Сигнал для обновления красных точек (бабблов) в общем списке проектов
      io.emit('unread_update', { 
        projectId: parseInt(projectId),
        senderId: senderId 
      });
      
      console.log(`✉️ [Chat] New message in PRJ-${projectId} from ${message.sender.name}`);
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

    // Обновляем только те сообщения, которые отправил НЕ текущий пользователь
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

    const io = req.app.get('io');
    if (io) {
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