import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { config } from 'dotenv';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { connectDB } from './config/db.js';
import { prisma } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
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

// --- Middleware авторизации сокетов (проверка JWT из cookies) ---
io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) {
      console.log(`[Socket Auth] No cookies, rejecting ${socket.id}`);
      return next(new Error('Authentication error: no cookies'));
    }

    // Парсим cookies вручную
    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) cookies[name] = value;
    });

    const token = cookies['jwt'];
    if (!token) {
      console.log(`[Socket Auth] No JWT token, rejecting ${socket.id}`);
      return next(new Error('Authentication error: no token'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string; sessionId: string };
    const userId = Number(decoded.id);
    if (isNaN(userId)) {
      return next(new Error('Invalid user ID in token'));
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isBlocked: true, currentSessionId: true, name: true }
    });

    if (!user) {
      return next(new Error('User not found'));
    }

    if (user.isBlocked) {
      return next(new Error('User is blocked'));
    }

    // Проверка сессии (опционально, но рекомендуется)
    if (user.currentSessionId && user.currentSessionId !== decoded.sessionId) {
      return next(new Error('Session superseded'));
    }

    socket.data.user = {
      id: user.id,
      role: user.role,
      name: user.name
    };
    console.log(`[Socket Auth] Authorized socket ${socket.id} as ${user.name} (${user.role})`);
    next();
  } catch (err: any) {
    console.error(`[Socket Auth] Error: ${err.message}`);
    next(new Error('Authentication error'));
  }
});

// --- Express middleware ---
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

// --- Socket.IO event handlers ---
io.on('connection', (socket) => {
  const user = socket.data.user;
  if (!user) {
    console.log(`🔴 Unauthorized socket ${socket.id} disconnected`);
    socket.disconnect();
    return;
  }

  console.log(`🟢 New connection: ${socket.id} (user ${user.id}, ${user.role})`);

  // Присоединение к личной комнате пользователя (для уведомлений)
  socket.join(`user_${user.id}`);

  // Подписка админов на статистику
  if (user.role === 'ADMIN' || user.role === 'MANAGER') {
    socket.join('admin_room');
    // Отправляем текущую статистику сразу
    fetchStatsInternal().then(stats => {
      socket.emit('stats_updated', stats);
    }).catch(err => console.error('Stats error:', err));
  }

  // Обработка выхода пользователя (logout)
  socket.on('user_logging_out', async () => {
    console.log(`🚪 User ${user.id} logged out intentionally`);
    socket.leave(`user_${user.id}`);
    socket.leave('admin_room');
    // Пересчитать статистику и разослать админам
    const stats = await fetchStatsInternal();
    io.to('admin_room').emit('stats_updated', stats);
    io.to('admin_room').emit('user:offline', user.id);
  });

  // Присоединение к комнате проекта (для чата)
  socket.on('join_project', ({ projectId }) => {
    if (!projectId) return;
    const room = `project_${projectId}`;
    socket.join(room);
    console.log(`📢 [Socket] ${user.name || user.id} (${user.role}) joined room: ${room}`);
  });

  // Отписка от статистики (если нужно)
  socket.on('unsubscribe_admin_stats', () => {
    socket.leave('admin_room');
  });

  // Обработка отключения (закрытие вкладки)
  socket.on('disconnect', async (reason) => {
    console.log(`🔴 Disconnected: ${socket.id}, user ${user.id}, reason: ${reason}`);
    // Задержка, чтобы не сработало при перезагрузке страницы
    setTimeout(async () => {
      const activeSockets = await io.fetchSockets();
      const stillConnected = activeSockets.some(s => s.data.user?.id === user.id);
      if (!stillConnected) {
        console.log(`📡 User ${user.id} is now fully offline`);
        const stats = await fetchStatsInternal();
        io.to('admin_room').emit('stats_updated', stats);
        io.to('admin_room').emit('user:offline', user.id);
      }
    }, 1500);
  });
});

httpServer.listen(Number(PORT), HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});