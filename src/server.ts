import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { config } from 'dotenv';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import morgan from 'morgan';
import { connectDB } from './config/db.js';
import { prisma } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import adminRoutes from './routes/adminRoutes'
import { fetchStatsInternal, setIoInstance } from './controllers/userController.js';
import { errorHandler } from './middleware/errorHandler.js';
import logger from './utils/logger.js';

config();
connectDB();

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const socketUrl = process.env.SOCKET_URL || 'http://localhost:5001';
const apiUrl = process.env.VITE_API_URL || 'http://localhost:5001';

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : [clientUrl];

console.log(`🛡️ Allowed Origins: ${allowedOrigins.join(', ')}`);
console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);

// --- HELMET с настройкой CSP ---
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          ...(isProduction ? [] : ["'unsafe-inline'", "'unsafe-eval'"]),
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: [
          "'self'",
          apiUrl,
          socketUrl,
          ...(isProduction ? [] : ['ws://localhost:5173', 'http://localhost:5173']),
        ],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
      reportOnly: !isProduction,
    },
  })
);

// --- Middleware для обогащения req.logMeta (IP, userAgent) ---
app.use((req, res, next) => {
  req.logMeta = {
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    method: req.method,
    url: req.url,
  };
  next();
});

// --- HTTP request logging (morgan + winston) ---
const morganStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};
app.use(morgan('combined', { stream: morganStream }));

// --- CORS ---
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

// --- Rate limiting ---
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

app.use('/api/', generalLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/chat', chatLimiter, chatRoutes);
app.use('/api/admin', adminRoutes);

// --- Global error handler (после всех роутов) ---
app.use(errorHandler);

// --- HTTP Server & Socket.IO ---
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

// --- Socket.IO authentication middleware ---
io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) {
      console.log(`[Socket Auth] No cookies, rejecting ${socket.id}`);
      return next(new Error('Authentication error: no cookies'));
    }

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
    if (isNaN(userId)) return next(new Error('Invalid user ID in token'));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isBlocked: true, currentSessionId: true, name: true }
    });

    if (!user) return next(new Error('User not found'));
    if (user.isBlocked) return next(new Error('User is blocked'));
    if (user.currentSessionId && user.currentSessionId !== decoded.sessionId) {
      return next(new Error('Session superseded'));
    }

    socket.data.user = { id: user.id, role: user.role, name: user.name };
    console.log(`[Socket Auth] Authorized socket ${socket.id} as ${user.name} (${user.role})`);
    next();
  } catch (err: any) {
    console.error(`[Socket Auth] Error: ${err.message}`);
    next(new Error('Authentication error'));
  }
});

// --- Socket.IO event handlers ---
io.on('connection', (socket) => {
  const user = socket.data.user;
  if (!user) {
    console.log(`🔴 Unauthorized socket ${socket.id} disconnected`);
    socket.disconnect();
    return;
  }

  console.log(`🟢 New connection: ${socket.id} (user ${user.id}, ${user.role})`);

  socket.join(`user_${user.id}`);

  if (user.role === 'ADMIN' || user.role === 'MANAGER') {
    socket.join('admin_room');
    fetchStatsInternal().then(stats => {
      socket.emit('stats_updated', stats);
    }).catch(err => console.error('Stats error:', err));
  }

  socket.on('identify_user', async ({ userId, userRole }) => {
    if (userRole === 'ADMIN' || userRole === 'MANAGER') {
      socket.join('admin_room');
      const stats = await fetchStatsInternal();
      socket.emit('stats_updated', stats);
    }
    if (userRole !== 'ADMIN') {
      io.to('admin_room').emit('user:online', userId);
    }
  });

  socket.on('join_project', ({ projectId }) => {
    if (!projectId) return;
    const room = `project_${projectId}`;
    socket.join(room);
    console.log(`📢 [Socket] ${user.name || user.id} (${user.role}) joined room: ${room}`);
  });

  socket.on('user_logging_out', async () => {
    console.log(`🚪 User ${user.id} logged out intentionally`);
    socket.leave(`user_${user.id}`);
    socket.leave('admin_room');
    io.to('admin_room').emit('user:offline', user.id);
    const stats = await fetchStatsInternal();
    io.to('admin_room').emit('stats_updated', stats);
  });

  socket.on('subscribe_admin_stats', async () => {
    if (user.role === 'ADMIN' || user.role === 'MANAGER') {
      socket.join('admin_room');
      const stats = await fetchStatsInternal();
      socket.emit('stats_updated', stats);
    }
  });

  socket.on('unsubscribe_admin_stats', () => {
    socket.leave('admin_room');
  });

  socket.on('disconnect', async (reason) => {
    console.log(`🔴 Disconnected: ${socket.id}, user ${user.id}, reason: ${reason}`);
    setTimeout(async () => {
      const activeSockets = await io.fetchSockets();
      const stillConnected = activeSockets.some(s => s.data.user?.id === user.id);
      if (!stillConnected) {
        console.log(`📡 User ${user.id} is now fully offline`);
        if (user.role !== 'ADMIN') {
          io.to('admin_room').emit('user:offline', user.id);
        }
        const stats = await fetchStatsInternal();
        io.to('admin_room').emit('stats_updated', stats);
      }
    }, 1500);
  });
});

httpServer.listen(Number(PORT), HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});