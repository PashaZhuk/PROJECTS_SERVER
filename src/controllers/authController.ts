import type { Response, Request } from 'express';
import { prisma } from '../config/db.js'
import bcrypt from 'bcrypt'
import { generateToken } from '../utils/generateToken'
import { emitStatsUpdate } from './userController';

interface AuthRequest extends Request {
  user?: any;
}

const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, role, unp, companyName } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Пожалуйста, заполните все обязательные поля" });
    }

    const userExist = await prisma.user.findUnique({ where: { email } });
    if (userExist) {
      return res.status(400).json({ error: "Пользователь с таким Email уже существует" });
    }

    if (role === 'ADMIN') {
      return res.status(403).json({ error: "Недостаточно прав для создания администратора" });
    }

    if (role === 'USER') {
      if (!unp || !companyName) {
        return res.status(400).json({ error: "Для партнера обязательны УНП и название компании" });
      }

      const cleanUnp = unp.toString().trim();
      const cleanCompanyName = companyName.trim();

      const partnerConflict = await prisma.user.findFirst({
        where: {
          OR: [
            { unp: cleanUnp },
            { companyName: { equals: cleanCompanyName, mode: 'insensitive' } }
          ]
        }
      });

      if (partnerConflict) {
        const isUnpMatch = partnerConflict.unp === cleanUnp;
        return res.status(400).json({
          error: isUnpMatch
            ? `Партнер с УНП ${cleanUnp} уже зарегистрирован`
            : `Компания "${cleanCompanyName}" уже существует в системе`
        });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({ 
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: role || 'USER',
        unp: role === 'USER' ? unp.toString().trim() : null,
        companyName: role === 'USER' ? companyName.trim() : null,
        mustChangePassword: true
      },
    });

    emitStatsUpdate(req.app.get('io'));

    res.status(201).json({
      status: "success",
      message: "Пользователь успешно создан",
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          companyName: user.companyName
        }
      }
    });
  } catch (error: any) {
    console.error("Registration Error:", error);
    if (error.code === 'P2002') {
      const field = error.meta?.target;
      return res.status(400).json({
        error: `Данные в поле ${field} уже используются`
      });
    }
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
};

const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // 🔑 ГЕНЕРАЦИЯ НОВОЙ СЕССИИ
    const { token, sessionId } = generateToken(String(user.id), res);

    // 🌐 СОКЕТ-ЛОГИКА: ВЫТЕСНЕНИЕ ПРЕДЫДУЩЕЙ СЕССИИ
    const io = req.app.get('io');
    if (io && user.currentSessionId) {
      // Отправляем сигнал в персональную комнату пользователя
      // Все вкладки, где этот пользователь залогинен, получат это событие
      io.to(`user_${user.id}`).emit('session_superseded');
    }

    // 💾 СОХРАНЕНИЕ SESSION ID В БД
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        currentSessionId: sessionId,
        lastSeen: new Date()
      }
    });

    emitStatsUpdate(io);

    if (io) {
      io.to('admin_room').emit('user_status_changed', { 
        userId: user.id, 
        lastSeen: new Date() 
      });
    }

    res.status(200).json({
      status: "success",
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          mustChangePassword: user.mustChangePassword
        },
        token
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login error" });
  }
};

const logout = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const io = req.app.get('io');

    if (userId) {
      // Ставим дату чуть в прошлом, чтобы в админке статус обновился корректно
      const oldDate = new Date(Date.now() - 10 * 60 * 1000);
      
      await prisma.user.update({
        where: { id: userId },
        data: { 
          lastSeen: oldDate,
          currentSessionId: null // Очищаем сессию при ручном выходе
        }
      });

      if (io) {
        io.to('admin_room').emit('user_status_changed', { 
          userId, 
          lastSeen: oldDate 
        });
        emitStatsUpdate(io);
      }
    }

    res.clearCookie('jwt', {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/"
    });

    return res.status(200).json({ status: "success" });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: "Logout failed" });
  }
};

const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const { password, ...userData } = user;
    res.status(200).json({
      status: "success",
      data: userData
    });
  } catch (error) {
    console.error("Get Profile Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export { register, login, logout, getProfile }