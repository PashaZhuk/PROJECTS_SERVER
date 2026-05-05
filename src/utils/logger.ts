import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const isProduction = process.env.NODE_ENV === 'production';
const logDir = 'logs';

// Формат для файлов (JSON)
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Формат для консоли (читаемый)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Транспорты
const consoleTransport = new winston.transports.Console({
  format: consoleFormat,
  level: isProduction ? 'info' : 'debug',
});

const errorRotateTransport = new DailyRotateFile({
  filename: path.join(logDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: '10m',
  maxFiles: '5',
  format: customFormat,
});

const combinedRotateTransport = new DailyRotateFile({
  filename: path.join(logDir, 'combined-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: customFormat,
});

let debugTransport: DailyRotateFile | null = null;
if (!isProduction) {
  debugTransport = new DailyRotateFile({
    filename: path.join(logDir, 'debug-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'debug',
    maxSize: '10m',
    maxFiles: '3',
    format: customFormat,
  });
}

const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  transports: [
    consoleTransport,
    errorRotateTransport,
    combinedRotateTransport,
    ...(debugTransport ? [debugTransport] : []),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logDir, 'rejections.log') }),
  ],
});

// Расширяем тип Request для logMeta (можно вынести в отдельный файл types, но пока оставим здесь)
declare global {
  namespace Express {
    interface Request {
      logMeta?: Record<string, any>;
    }
  }
}

export default logger;