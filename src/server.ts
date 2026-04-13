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
import { fetchStatsInternal } from './controllers/userController.js';

// Загрузка переменных окружения
config();

// Подключение к БД
connectDB();

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = process.env.HOST || '0.0.0.0';

// Парсинг списка разрешенных адресов из .env
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : ['http://localhost:5173'];

console.log(`🛡️ Allowed Origins: ${allowedOrigins.join(', ')}`);

// --- Rate Limiting ---
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 500, // лимит запросов
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов, попробуйте позже." }
});

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 минута
  max: 30,
  message: { error: "Вы отправляете сообщения слишком часто. Подождите минуту." }
});

// --- Server & Socket Setup ---
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Разрешаем запросы без origin (например, мобильные приложения или curl)
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

app.set('io', io);

// --- Middleware ---
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

// --- Routes ---
app.use('/api/', generalLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/chat', chatLimiter, chatRoutes);

// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
  console.log(`🟢 New connection: ${socket.id}`);

  socket.on('join_self_room', (userId) => {
    if (userId) {
      const roomName = `user_${userId}`;
      socket.join(roomName);
      console.log(`👤 Socket ${socket.id} joined private room: ${roomName}`);
    }
  });

  socket.on('join_project', ({ projectId, userId, userName, userRole }) => {
    const roomName = `project_${projectId}`;
    socket.join(roomName);
    
    socket.data.userId = userId;
    socket.data.userName = userName;
    socket.data.userRole = userRole;
    socket.data.projectId = projectId;
    
    console.log(`📁 Socket ${socket.id} (User: ${userId}, ${userName}, Role: ${userRole}) joined ${roomName}`);
    
    if (userRole === 'MANAGER') {
      socket.to(roomName).emit('system_message', {
        text: `Менеджер ${userName} присоединился к обсуждению`,
        type: 'INFO',
        createdAt: new Date()
      });
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

  socket.on('disconnect', (reason) => {
    console.log(`🔴 User disconnected: ${socket.id}. Reason: ${reason}`);
  });
});

// --- Start Server ---
httpServer.listen(Number(PORT), HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
  console.log(`📡 Listening for connections from: ${allowedOrigins.join(', ')}`);
});