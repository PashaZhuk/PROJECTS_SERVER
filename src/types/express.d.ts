import type { Request } from 'express';

// B20/B21: Общий тип AuthRequest для контроллеров и middleware
export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: 'USER' | 'MANAGER' | 'ADMIN';
  companyName: string | null;
  unp: string | null;
  phone: string | null;
  mustChangePassword: boolean;
  isBlocked: boolean;
  currentSessionId: string | null;
  lastSeen: Date;
  password?: string;
}

export interface LogMeta {
  ip?: string;
  userAgent?: string;
  method?: string;
  url?: string;
  userId?: number;
  email?: string;
  name?: string | null;
  companyName?: string | null;
  displayName?: string;
  role?: string;
}

export interface AuthRequest<Body = any, Params = any> extends Request<Params, any, Body> {
  user?: AuthUser;
  logMeta?: LogMeta;
}