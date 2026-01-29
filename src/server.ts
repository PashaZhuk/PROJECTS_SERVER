import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { config } from 'dotenv';
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import cookieParser from 'cookie-parser';
import { fetchStatsInternal } from './controllers/userController.js'; // Импортируем хелпер для первичной отправки

config();
connectDB();

const app = express();
const PORT = 5001;

// 1. СОЗДАНИЕ HTTP И SOCKET СЕРВЕРОВ
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://192.168.85.110:5173"],
    credentials: true
  }
});

/**
 * ВАЖНО: Делаем объект io доступным во всех контроллерах.
 * Теперь в любом контроллере можно написать: req.app.get('io').emit(...)
 */
app.set('io', io);

// 2. MIDDLEWARES
app.use(cors({
  origin: ['http://localhost:5173', 'http://192.168.85.110:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 3. МАРШРУТЫ (ROUTES)
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/chat', chatRoutes);

// 4. SOCKET.IO LOGIC
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // --- ЛОГИКА ДЛЯ ПРОЕКТОВ ---
  socket.on('join_project', (projectId) => {
    socket.join(`project_${projectId}`);
    console.log(`Socket ${socket.id} joined project_${projectId}`);
  });

  // --- ЛОГИКА ДЛЯ АДМИН-ПАНЕЛИ (СТАТИСТИКА) ---
  /**
   * Когда админ заходит в Dashboard, фронтенд отправляет 'subscribe_admin_stats'.
   * Мы помещаем его сокет в отдельную комнату 'admin_room'.
   */
  socket.on('subscribe_admin_stats', async () => {
    socket.join('admin_room');
    console.log(`Socket ${socket.id} joined admin_room`);

    // Сразу после подписки отправляем свежие данные только этому сокету
    try {
      const initialStats = await fetchStatsInternal();
      socket.emit('stats_updated', initialStats);
    } catch (err) {
      console.error("Error sending initial stats to socket:", err);
    }
  });

  /**
   * Если админ уходит со страницы статистики, он может отписаться
   */
  socket.on('unsubscribe_admin_stats', () => {
    socket.leave('admin_room');
    console.log(`Socket ${socket.id} left admin_room`);
  });

  // --- ОТКЛЮЧЕНИЕ ---
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// 5. ЗАПУСК
httpServer.listen(PORT, () => {
  console.log(`
🚀 Server running on port ${PORT}
🌐 API: http://localhost:${PORT}/api
🔌 WebSockets: Enabled
  `);
});