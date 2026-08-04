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
import { connectDB, disconnectDB } from './config/db.js';
import { prisma } from './config/db.js';
import { rotateRefreshToken } from './utils/generateToken.js';
import { parseCookies } from './utils/cookies.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import companyRoutes from './routes/companyRoutes.js';
import managerRoutes from './routes/managerRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import newsRoutes from './routes/newsRoutes.js';
import integrationRoutes from './routes/integrationRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import logger from './utils/logger.js';
import { setIo, fetchStatsInternal, emitStatsUpdate } from './services/statsService.js';

config();

// B9: Fail-fast proverca JWT_SECRET na starte servera
if (!process.env.JWT_SECRET) {
  console.error(' FATAL: JWT_SECRET is not defined. Server cannot start.');
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', { reason: String(reason) });
  process.exit(1);
});
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

logger.info('Allowed Origins: ' + allowedOrigins.join(', '));
logger.info('Environment: ' + (process.env.NODE_ENV || 'development'));

// Helmet CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...(isProduction ? [] : ["'unsafe-inline'", "'unsafe-eval'"])],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", apiUrl, socketUrl, ...(isProduction ? [] : ['ws://localhost:5173', 'http://localhost:5173'])],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
      reportOnly: !isProduction,
    },
  })
);

// Middleware for metadata
app.use((req, res, next) => {
  req.logMeta = {
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    method: req.method,
    url: req.url,
  };
  next();
});

// Morgan + winston
const morganStream = { write: (message: string) => logger.info(message.trim()) };
app.use(morgan('combined', { stream: morganStream }));

// CORS
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition']
}));

// B10: унифицированный лимит body — 50mb (broadcast-вложения до 25MB + запас)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// S1: Health-check эндпоинт
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: true, uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'error', db: false, uptime: process.uptime() });
  }
});

// Rate limiting
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
const chatLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 30 });
app.use('/api/', generalLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/chat', chatLimiter, chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/integration', integrationRoutes);

// Swagger UI — только в development
if (process.env.NODE_ENV !== 'production') {
  const swaggerUi = (await import('swagger-ui-express')).default
  const { swaggerSpec } = await import('./config/swagger.js')
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'B2B Portal API',
  }))
  logger.info('Swagger UI: /api-docs')
}

app.use(errorHandler);

// HTTP & Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST']
  }
});

setIo(io);
app.set('io', io);

// B12: используем вынесенный parseCookies вместо дублирования
io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    const cookies = parseCookies(cookieHeader);
    const token = cookies['jwt'];
    if (!token) return next(new Error('Authentication error: no token'));
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string; sessionId: string };
    const userId = Number(decoded.id);
    if (isNaN(userId)) return next(new Error('Invalid user ID in token'));
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isBlocked: true, currentSessionId: true, name: true, companyName: true }
    });
    if (!user) return next(new Error('User not found'));
    if (user.isBlocked) return next(new Error('User is blocked'));
    if (user.currentSessionId && user.currentSessionId !== decoded.sessionId) return next(new Error('Session superseded'));
    socket.data.user = { id: user.id, role: user.role, name: user.name, companyName: user.companyName };
    socket.data.userId = user.id;
    socket.data.userRole = user.role;
    next();
  } catch (err: any) {
    // Если JWT истёк — пробуем обновить через refreshToken
    if (err.name === 'TokenExpiredError') {
      try {
        const cookieHeader = socket.handshake.headers.cookie;
        const cookies = parseCookies(cookieHeader);
        const rawRefresh = cookies['refreshToken'];
        if (!rawRefresh) return next(new Error('Authentication error: no refresh token'));

        // B13: используем rotateRefreshToken с детектом reuse вместо ручной ротации
        const res = (socket as any).request?.res;
        const result = await rotateRefreshToken(rawRefresh, res);

        if (!result.success) {
          return next(new Error('Authentication error: invalid refresh token'));
        }

        const user = result.user;
        if (!user || user.isBlocked) return next(new Error('User is blocked'));

        socket.data.user = { id: user.id, role: user.role, name: user.name, companyName: user.companyName };
        socket.data.userId = user.id;
        socket.data.userRole = user.role;
        return next();
      } catch {
        return next(new Error('Authentication error'));
      }
    }
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  if (!user) {
    socket.disconnect();
    return;
  }

  logger.info('New connection: ' + socket.id + ' (user ' + user.id + ', ' + user.role + ')');

  socket.join('user_' + user.id);
  if (user.role === 'ADMIN' || user.role === 'MANAGER') {
    socket.join('admin_room');
    fetchStatsInternal().then(stats => socket.emit('stats_updated', stats));
  }

  if (user.role !== 'ADMIN') {
    io.to('admin_room').emit('user:online', user.id);
    emitStatsUpdate();
  }

  socket.on('join_project', ({ projectId }) => {
    if (!projectId) return;
    const room = 'project_' + projectId;
    socket.join(room);
    logger.info('[Socket] ' + user.name + ' (' + user.role + ') joined room: ' + room);
  });

  socket.on('user_logging_out', async () => {
    logger.info('User ' + user.id + ' logged out intentionally');
    socket.leave('user_' + user.id);
    socket.leave('admin_room');
    if (user.role !== 'ADMIN') {
      io.to('admin_room').emit('user:offline', user.id);
      await emitStatsUpdate();
    }
  });

  socket.on('disconnect', async () => {
    logger.info('Disconnected: ' + socket.id + ', user ' + user.id);
    setTimeout(async () => {
      const activeSockets = await io.fetchSockets();
      const stillConnected = activeSockets.some(s => s.data.userId === user.id);
      if (!stillConnected && user.role !== 'ADMIN') {
        logger.info('User ' + user.id + ' is now fully offline');
        io.to('admin_room').emit('user:offline', user.id);
        await emitStatsUpdate();
      }
    }, 1500);
  });
});

// B19: Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(signal + ' received. Starting graceful shutdown...');
  try {
    logger.info('Closing HTTP server...');
    httpServer.close();
    logger.info('Closing Socket.IO...');
    io.close();
    logger.info('Disconnecting from database...');
    await disconnectDB();
    logger.info('Graceful shutdown complete.');
    process.exit(0);
  } catch (err: any) {
    logger.error('Error during graceful shutdown:', { error: err.message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

logger.info('Starting HTTP server...');
httpServer.listen(Number(PORT), HOST, () => {
  logger.info('Server running on http://' + HOST + ':' + PORT);
  logger.info('DB: ' + (process.env.DATABASE_URL ? 'configured' : 'missing'));
});
