import type { Response, Request } from 'express';
import { prisma } from '../config/db.js';
import bcrypt from 'bcrypt';
import { generateToken } from '../utils/generateToken';
import { emitStatsUpdate } from './userController';
import { v4 as uuidv4 } from 'uuid'; // Для генерации токена
import { sendEmail, generateResetPasswordEmail, generateWelcomeEmail } from '../services/emailService'; // Импортируем сервис

interface AuthRequest extends Request {
  user?: any;
}

// --- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ОТПРАВКИ ПРИВЕТСТВИЯ ---
const sendWelcomeEmailToUser = async (email: string, name: string, plainPassword: string) => {
  try {
    const loginUrl = process.env.CLIENT_URL || 'http://localhost:5173/login';
    const html = generateWelcomeEmail(name, email, plainPassword, loginUrl);
    await sendEmail({
      to: email,
      subject: 'Добро пожаловать в IPMATICA Hub!',
      html: html
    });
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    // Не прерываем регистрацию, если письмо не ушло, но логируем ошибку
  }
};

const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, role, unp, companyName, phone } = req.body;

    // 🔥 ИЗМЕНЕНИЕ 1: Гибкая валидация обязательных полей
    if (!email || !password) {
      return res.status(400).json({ error: "Email и пароль обязательны" });
    }

    // Проверка имени: обязательно для Менеджера, опционально для Партнера
    if (role === 'MANAGER' && !name) {
      return res.status(400).json({ error: "Для менеджера обязательно ФИО" });
    }
    
    // Если имя не передано для партнера, используем название компании как имя (для совместимости) 
    // или оставляем пустым, если база позволяет null. 
    // Лучший вариант: если имени нет, берем компанию.
    const finalName = name ? name.trim() : (companyName ? companyName.trim() : 'Партнер');

    const userExist = await prisma.user.findUnique({ where: { email } });
    if (userExist) {
      return res.status(400).json({ error: "Пользователь с таким Email уже существует" });
    }

    if (role === 'ADMIN') {
      return res.status(403).json({ error: "Недостаточно прав для создания администратора" });
    }

    // 🔥 ИЗМЕНЕНИЕ 2: Валидация данных партнера
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
        // 🔥 ИЗМЕНЕНИЕ 3: Используем finalName
        name: finalName, 
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: role || 'USER',
        phone: role === 'USER' ? phone : null, 
        unp: role === 'USER' ? unp.toString().trim() : null,
        companyName: role === 'USER' ? companyName.trim() : null,
        mustChangePassword: true
      },
    });

    // 🔥 ОТПРАВКА ПИСЬМА ПРИВЕТСТВИЯ
    // Внимание: если имени не было, в письме будет "Здравствуйте, ООО Ромашка!"
    await sendWelcomeEmailToUser(user.email, user.name, password);

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
    
    // Обработка ошибок уникальности (P2002)
    if (error.code === 'P2002') {
      const meta = error.meta;
      let targetFields: string[] = [];

      // 1. Пытаемся извлечь поля из meta.target
      if (meta) {
        if (Array.isArray(meta.target)) {
          targetFields = meta.target;
        } else if (typeof meta.target === 'string') {
          targetFields = [meta.target];
        }
      }

      // Преобразуем массив полей в строку для надежного поиска
      const targetString = targetFields.join(',').toLowerCase();
      
      // Также проверяем сообщение ошибки от драйвера (иногда там есть подсказки)
      const errorMessage = error.message?.toLowerCase() || '';

      // 🔥 ПРОВЕРКИ (используем includes для надежности)
      
      // Проверка телефона
      if (targetFields.includes('phone') || targetString.includes('phone') || errorMessage.includes('phone')) {
        return res.status(400).json({ 
          error: "Этот номер телефона уже зарегистрирован в системе" 
        });
      }
      
      // Проверка Email
      if (targetFields.includes('email') || targetString.includes('email') || errorMessage.includes('email')) {
        return res.status(400).json({ 
          error: "Пользователь с таким Email уже существует" 
        });
      }
      
      // Проверка УНП
      if (targetFields.includes('unp') || targetString.includes('unp') || errorMessage.includes('unp')) {
        return res.status(400).json({ 
          error: "Партнер с таким УНП уже зарегистрирован" 
        });
      }

      // Если ничего не подошло, выводим общую ошибку с деталями для отладки (в консоли)
      console.warn("Неизвестное поле нарушения уникальности:", meta);
      return res.status(400).json({ 
        error: "Данные уже используются в системе" 
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

    const { token, sessionId } = generateToken(String(user.id), res);

    const io = req.app.get('io');
    if (io && user.currentSessionId) {
      io.to(`user_${user.id}`).emit('session_superseded');
    }

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
      const oldDate = new Date(Date.now() - 10 * 60 * 1000);
      
      await prisma.user.update({
        where: { id: userId },
        data: { 
          lastSeen: oldDate,
          currentSessionId: null 
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

// 🔥 НОВАЯ ФУНКЦИЯ: ЗАПРОС НА СБРОС ПАРОЛЯ
const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    
    const user = await prisma.user.findUnique({ where: { email } });
    
    // В целях безопасности всегда возвращаем успех, даже если email не найден
    // Чтобы злоумышленник не мог проверить наличие email в базе
    if (!user) {
      return res.json({ status: "success", message: "Если такой пользователь существует, письмо отправлено." });
    }

    // Генерируем токен
    const resetToken = uuidv4();
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 час

    // Сохраняем в БД
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetToken,
        resetPasswordExpires: resetTokenExpiry
      }
    });

    // Формируем ссылку
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const resetLink = `${clientUrl}/reset-password?token=${resetToken}`;

    // Отправляем письмо
    const html = generateResetPasswordEmail(resetLink);
    await sendEmail({
      to: user.email,
      subject: 'Сброс пароля IPMATICA Hub',
      html: html
    });

    res.json({ status: "success", message: "Письмо со ссылкой для сброса пароля отправлено." });

  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ error: "Ошибка сервера при отправке письма" });
  }
};

// 🔥 НОВАЯ ФУНКЦИЯ: УСТАНОВКА НОВОГО ПАРОЛЯ
const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Неверные данные" });
    }

    // Ищем пользователя по токену и проверяем срок действия
    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: token,
        resetPasswordExpires: {
          gte: new Date() // Токен должен быть еще действителен
        }
      }
    });

    if (!user) {
      return res.status(400).json({ error: "Ссылка недействительна или срок её действия истек" });
    }

    // Хэшируем новый пароль
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Обновляем пароль и очищаем поля токена
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        mustChangePassword: false // Если пользователь сам сменил пароль, флаг можно снять
      }
    });

    res.json({ status: "success", message: "Пароль успешно изменен" });

  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ error: "Ошибка сервера при смене пароля" });
  }
};

export { register, login, logout, getProfile, forgotPassword, resetPassword };