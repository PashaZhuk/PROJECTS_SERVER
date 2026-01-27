import type { Response, Request } from 'express';
import {prisma} from '../config/db.js'
import bcrypt from 'bcrypt'

interface AuthRequest extends Request {
    user?: any;
}


const getUsers = async (req: any, res: Response) => {
  try {
    // Извлекаем всех пользователей, исключая поле password для безопасности
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyName: true,
        unp: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc', // Новые пользователи будут вверху списка
      },
    });

    res.status(200).json({
      status: 'success',
      results: users.length,
      data: users,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Не удалось получить список пользователей',
    });
  }
};

const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Проверяем, не пытается ли админ удалить самого себя
    if (Number(id) === (req as any).user.id) {
      return res.status(400).json({ error: "Вы не можете удалить свою собственную учетную запись" });
    }

    const user = await prisma.user.findUnique({ where: { id: Number(id) } });

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    await prisma.user.delete({
      where: { id: Number(id) }
    });

    res.status(200).json({
      status: "success",
      message: "Пользователь успешно удален"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Ошибка сервера при удалении" });
  }
};

const changeDefaultPassword =async (req: AuthRequest, res: Response) => {
  const { newPassword } = req.body;
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  await prisma.user.update({
    where: { id: req.user.id },
    data: { 
      password: hashedPassword, 
      mustChangePassword: false // Сбрасываем флаг!
    }
  });

  res.json({ status: "success" });
};


export {getUsers,deleteUser, changeDefaultPassword}