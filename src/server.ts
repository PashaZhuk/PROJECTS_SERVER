import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { config } from 'dotenv';
import rateLimit from 'express-rate-limit';
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import cookieParser from 'cookie-parser';
import { fetchStatsInternal, setIoInstance } from './controllers/userController.js';

config();
connectDB();

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = process.env.HOST || '0.0.0.0';

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : ['http://localhost:5173'];

console.log(`🛡️ Allowed Origins: ${allowedOrigins.join(', ')}`);

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов, попробуйте позже." }
});

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: "Вы отправляете сообщения слишком часто. Подождите минуту." }
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST']
  }
});

setIoInstance(io);
app.set('io', io);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

app.use('/api/', generalLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/chat', chatLimiter, chatRoutes);

// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
  console.log(`🟢 New connection: ${socket.id}`);

  // 1. ИДЕНТИФИКАЦИЯ
  socket.on('identify_user', async ({ userId, userRole }) => {
    if (userId) {
      socket.data.userId = userId;
      socket.data.userRole = userRole;
      
      console.log(`👤 Socket ${socket.id} identified as User ${userId} (${userRole})`);
      
      // Входим в личную комнату
      socket.join(`user_${userId}`);
      
      // Уведомляем админов, что юзер в сети
      io.to('admin_room').emit('user:online', userId);

      // Обновляем статистику для админов
      const stats = await fetchStatsInternal();
      io.to('admin_room').emit('stats_updated', stats);
    }
  });

  // 🔥 2. ОБРАБОТКА НАМЕРЕННОГО ВЫХОДА (LOGOUT)
  socket.on('user_logging_out', async () => {
    const userId = socket.data.userId;
    if (userId) {
      console.log(`🚪 User ${userId} logged out intentionally`);
      
      // Сразу шлем статус "оффлайн" админам
      io.to('admin_room').emit('user:offline', userId);
      
      // Покидаем комнаты
      socket.leave(`user_${userId}`);
      socket.leave('admin_room');
      
      // Стираем данные, чтобы событие disconnect не сработало повторно для этого юзера
      delete socket.data.userId;
      
      // Пересчитываем статистику
      const stats = await fetchStatsInternal();
      io.to('admin_room').emit('stats_updated', stats);
    }
  });

  socket.on('join_self_room', (userId) => {
    if (userId) {
      if (!socket.data.userId) {
         socket.data.userId = userId; 
      }
      socket.join(`user_${userId}`);
    }
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

  // 3. ОБРАБОТКА ОТКЛЮЧЕНИЯ (ЗАКРЫТИЕ ВКЛАДКИ ИЛИ ПОТЕРЯ СЕТИ)
  socket.on('disconnect', (reason) => {
    const userId = socket.data.userId;
    
    if (userId) {
      console.log(`🔴 Identified user left: ${userId}. Reason: ${reason}`);
      
      // Задержка на случай перезагрузки страницы (F5)
      setTimeout(async () => {
        // Проверяем, не остались ли у юзера другие открытые вкладки (другие сокеты с тем же userId)
        const activeSockets = await io.fetchSockets();
        const stillConnected = activeSockets.some(s => s.data.userId === userId);

        if (!stillConnected) {
          console.log(`📡 User ${userId} is now fully offline`);
          
          const stats = await fetchStatsInternal();
          io.to('admin_room').emit('stats_updated', stats);
          io.to('admin_room').emit('user:offline', userId);
        }
      }, 1500); // 1.5 секунды достаточно для F5
    }
  });
});

httpServer.listen(Number(PORT), HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});