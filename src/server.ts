import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { config } from 'dotenv';
import rateLimit from 'express-rate-limit'; // Добавляем импорт
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import cookieParser from 'cookie-parser';
import { fetchStatsInternal } from './controllers/userController.js';

config();
connectDB();

const app = express();
const PORT = 5001;

// --- ЗАЩИТА (RATE LIMITING) ---

// 1. Общий лимит для всего API (защита от DDoS)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 500, // максимум 500 запросов с одного IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов, попробуйте позже." }
});

// 2. Лимит конкретно для чата (защита от спама сообщениями)
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 минута
  max: 30, // не более 30 сообщений в минуту
  message: { error: "Вы отправляете сообщения слишком часто. Подождите минуту." }
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://192.168.85.110:5173"],
    credentials: true
  }
});

app.set('io', io);

app.use(cors({
  origin: ['http://localhost:5173', 'http://192.168.85.110:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Ограничиваем размер входящего JSON (защита от "тяжелых" текстов)
app.use(express.json({ limit: '10kb' })); 
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Применяем общую защиту ко всем роутам
app.use('/api/', generalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/projects', projectRoutes);

// Для чата применяем дополнительный строгий лимит
app.use('/api/chat', chatLimiter, chatRoutes);

// --- SOCKET.IO LOGIC (без изменений) ---
io.on('connection', (socket) => {
  // ... твой существующий код сокетов ...
  console.log(`🟢 New connection: ${socket.id}`);

  socket.on('join_self_room', (userId) => {
    if (userId) {
      const roomName = `user_${userId}`;
      socket.join(roomName);
      console.log(`👤 Socket ${socket.id} joined private room: ${roomName}`);
    }
  });

 socket.on('join_project', ({ projectId, userName, userRole }) => {
  const roomName = `project_${projectId}`;
  socket.join(roomName);
  
  // Если зашел менеджер, уведомляем остальных
  if (userRole === 'MANAGER') {
    socket.to(roomName).emit('system_message', {
      text: `Менеджер ${userName} присоединился к обсуждению`,
      type: 'INFO',
      createdAt: new Date()
    });
  }
  
  console.log(`📁 Socket ${socket.id} (${userName}) joined ${roomName}`);
});

  socket.on('subscribe_admin_stats', async () => {
    socket.join('admin_room');
    try {
      const initialStats = await fetchStatsInternal();
      socket.emit('stats_updated', initialStats);
    } catch (err) {
      console.error("❌ Error sending initial stats:", err);
    }
  });

  socket.on('unsubscribe_admin_stats', () => {
    socket.leave('admin_room');
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔴 User disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});