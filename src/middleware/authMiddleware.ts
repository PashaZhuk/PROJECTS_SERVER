import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';

// Описываем структуру данных внутри JWT
interface JwtPayload {
  id: string;
  // добавь другие поля, если ты их шифруешь в токен
}

// Расширяем интерфейс Request специально для этого файла
// Или можно создать файл types/express.d.ts для глобального расширения
interface AuthRequest extends Request {
  user?: any; // Здесь можно указать тип User из Prisma
}

export const authMiddleware = async (
  req: AuthRequest, 
  res: Response, 
  next: NextFunction
) => {
  console.log("Auth middleware reached");
  let token: string | undefined;

  // 1. Извлекаем токен из заголовка или кук
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return res.status(401).json({ error: "Not authorized, no token provided" });
  }

  try {
    // 2. Верификация токена
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;

    // 3. Поиск пользователя в БД
    const userId = Number(decoded.id)
    if (isNaN(userId)) {
  return res.status(401).json({ error: "Invalid user ID format" });
}

const user = await prisma.user.findUnique({
  where: { id: userId } // Теперь здесь число, и TS будет доволен
});
    if (!user) {
      return res.status(401).json({ error: "User no longer exists" });
    }

    // 4. Записываем пользователя в объект запроса
    req.user = user;
    next();

  } catch (err) {
    return res.status(401).json({ error: "Not authorized, token failed" });
  }
};