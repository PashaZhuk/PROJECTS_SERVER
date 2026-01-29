import type { Response, Request } from 'express';
import { prisma } from '../config/db.js'
import bcrypt from 'bcrypt'
import { generateToken } from '../utils/generateToken'
// Импортируем хелпер для обновления статистики
import { emitStatsUpdate } from './userController'; 

interface AuthRequest extends Request {
    user?: any;
}

const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, role, unp, companyName } = req.body;

    // 1. Базовая валидация обязательных полей
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Пожалуйста, заполните все обязательные поля" });
    }

    // 2. Проверка существования Email
    const userExist = await prisma.user.findUnique({ where: { email } });
    if (userExist) {
      return res.status(400).json({ error: "Пользователь с таким Email уже существует" });
    }

    // 3. БЕЗОПАСНОСТЬ: Ограничение на создание ADMIN
    if (role === 'ADMIN') {
      return res.status(403).json({ error: "Недостаточно прав для создания администратора" });
    }

    // 4. СПЕЦИФИЧЕСКАЯ ПРОВЕРКА ДЛЯ ПАРТНЕРА (ROLE === 'USER')
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

    // 5. Хеширование пароля
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 6. Создание пользователя
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

    // --- ОБНОВЛЕНИЕ СТАТИСТИКИ (НОВЫЙ ЮЗЕР) ---
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
        
        const user = await prisma.user.findUnique({
            where: { email: email }
        });

        if (!user) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        // 1. Обновляем пользователя и СОХРАНЯЕМ результат в переменную
        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: { lastSeen: new Date() }
        });

        const token = generateToken(String(user.id), res);
        const io = req.app.get('io');

        // 2. ОБНОВЛЕНИЕ ОБЩЕЙ СТАТИСТИКИ (цифры в карточках)
        emitStatsUpdate(io);

        // 3. АДРЕСНОЕ ОБНОВЛЕНИЕ СТАТУСА (чтобы кружок в таблице загорелся мгновенно)
        // Импортируй эту функцию из userController или пропиши логику прямо здесь:
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

const logout = async (req: any, res: Response) => {
    try {
        const userId = req.user?.id;
        const io = req.app.get('io');

        console.log('Logout attempt for userId:', userId); // Проверка в консоли

        if (userId) {
            const oldDate = new Date(Date.now() - 10 * 60 * 1000);
            
            await prisma.user.update({
                where: { id: userId },
                data: { lastSeen: oldDate }
            });

            if (io) {
                console.log(`Sending offline status for user ${userId} to admin_room`);
                io.to('admin_room').emit('user_status_changed', { 
                    userId, 
                    lastSeen: oldDate 
                });
                emitStatsUpdate(io);
            }
        }

        res.cookie("jwt", "", { httpOnly: true, expires: new Date(0) });
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