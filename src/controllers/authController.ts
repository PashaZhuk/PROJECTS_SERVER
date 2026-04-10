import type { Response, Request } from 'express';
import { prisma } from '../config/db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
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

        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: { lastSeen: new Date() }
        });

        const token = generateToken(String(user.id), res);
        const io = req.app.get('io');

        emitStatsUpdate(io);

        if (io) {
            io.to('admin_room').emit('user_status_changed', {
                userId: user.id,
                lastSeen: updatedUser.lastSeen
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

// ⚠️ БЕЗ protect middleware на роуте — убери его в routes/auth.ts
// router.post('/logout', logout)  ← без protect
const logout = async (req: Request, res: Response) => {
    try {
        // reason и userId приходят из тела запроса (клиент всегда их передаёт)
        const { reason = 'manual', userId: bodyUserId } = req.body;

        const io = req.app.get('io');

        // Пытаемся дополнительно верифицировать userId из куки (если она ещё жива)
        let resolvedUserId = bodyUserId;
        try {
            const token = req.cookies?.jwt;
            if (token) {
                const decoded: any = jwt.verify(token, process.env.JWT_SECRET!);
                resolvedUserId = decoded?.userId || bodyUserId;
            }
        } catch {
            // Кука протухла или невалидна — используем userId из тела запроса
        }

        console.log(`[Auth] Logout — userId: ${resolvedUserId}, reason: ${reason}`);

        if (resolvedUserId) {
            const oldDate = new Date(Date.now() - 10 * 60 * 1000);

            await prisma.user.update({
                where: { id: resolvedUserId },
                data: { lastSeen: oldDate }
            });

            if (io) {
                io.to('admin_room').emit('user_status_changed', {
                    userId: resolvedUserId,
                    lastSeen: oldDate
                });
                emitStatsUpdate(io);
            }
        }

        // Очищаем куку в любом случае
        res.cookie("jwt", "", { httpOnly: true, expires: new Date(0) });
        return res.status(200).json({ status: "success", reason });

    } catch (error) {
        console.error('Logout error:', error);
        // Даже при ошибке чистим куку
        res.cookie("jwt", "", { httpOnly: true, expires: new Date(0) });
        return res.status(200).json({ status: "success" });
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
