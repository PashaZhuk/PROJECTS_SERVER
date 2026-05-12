import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid'; // Убедись, что установлен: npm install uuid @types/uuid
import type { Response } from 'express';

export const generateToken = (userId: string | number, res: Response): { token: string; sessionId: string } => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }

  const sessionId = uuidv4(); // Генерируем уникальный ID сессии

  const payload = { 
    id: userId,
    sessionId // Включаем в полезную нагрузку токена
  };

  const token = jwt.sign(payload, secret, {
    expiresIn: (process.env.JWT_EXPIRES_IN || "8h") as jwt.SignOptions['expiresIn']
  });

  res.cookie("jwt", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60 * 1000
  });

  return { token, sessionId };
};