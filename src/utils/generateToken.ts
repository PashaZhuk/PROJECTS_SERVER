import jwt from 'jsonwebtoken'; 
import type { Response } from 'express';

export const generateToken = (userId: string | number, res: Response): string => {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
        throw new Error('JWT_SECRET is not defined in environment variables');
    }

    // Создаем полезную нагрузку (payload)
    const payload = { id: userId };

    // Генерируем токен
    // Используем явное приведение типов для опций, чтобы TS не ругался на expiresIn
    const token = jwt.sign(payload, secret, {
        expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as jwt.SignOptions['expiresIn']
    });

    // Устанавливаем куки
    res.cookie("jwt", token, {
        httpOnly: true, // Защита от кражи токена через JS (XSS)
        secure: process.env.NODE_ENV === "production", // Только HTTPS в продакшене
        sameSite: "strict", // Защита от CSRF атак
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 дней в миллисекундах
    });

    return token;
};