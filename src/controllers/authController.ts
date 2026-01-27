import type { Response, Request } from 'express';
import { prisma } from '../config/db.js'
import bcrypt from 'bcrypt'
import { generateToken } from '../utils/generateToken'

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

      // Очистка данных (удаляем лишние пробелы)
      const cleanUnp = unp.toString().trim();
      const cleanCompanyName = companyName.trim();

      // Ищем существующего партнера по УНП или Названию
      const partnerConflict = await prisma.user.findFirst({
        where: {
          OR: [
            { unp: cleanUnp },
            { companyName: { equals: cleanCompanyName, mode: 'insensitive' } } // Без учета регистра
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
    
    // Обработка ошибок уникальности Prisma (на случай race condition)
    if (error.code === 'P2002') {
      const field = error.meta?.target;
      return res.status(400).json({ 
        error: `Данные в поле ${field} уже используются` 
      });
    }

    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
};

const login = async(req: Request, res: Response)=>{
    const { email, password } = req.body
    
    const user = await prisma.user.findUnique({
        where: { email : email }
    });

    if (!user){
        return res.status(401).json({ error: "Invalid email or password" })
    }

    const isPasswordValid = await bcrypt.compare(password, user.password)
    if(!isPasswordValid){
        return res.status(401).json({ error: "Invalid email or password" })
    }

    const token = generateToken(String(user.id), res)
    
    res.status(200).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                mustChangePassword: user.mustChangePassword // Важно для фронтенда!
            },
            token
        }
    })
}

const logout = async (req: Request, res: Response) =>{
    res.cookie("jwt", "", {
        httpOnly: true,
        expires: new Date(0),
    })
    res.status(200).json({
        status: "success",
        message: "Logged out successfully"
    })
}

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