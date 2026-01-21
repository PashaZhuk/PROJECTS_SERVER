import type { Response, Request } from 'express';
import {prisma} from '../config/db.js'
import bcrypt from 'bcrypt'
import {generateToken} from '../utils/generateToken'

interface AuthRequest extends Request {
    user?: any;
}


const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Please provide all fields" });
    }

    const userExist = await prisma.user.findUnique({ where: { email } });
    if (userExist) {
      return res.status(400).json({ error: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Создаем пользователя
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || 'USER', // Админ сам решает, какую роль дать
      },
    });

    // ВАЖНО: Мы НЕ вызываем generateToken(user.id, res).
    // Мы просто отправляем ответ об успехе.
    res.status(201).json({
      status: "success",
      message: "User created successfully by administrator",
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const login = async(req: Request, res: Response)=>{
    const{email,password} = req.body
    // Check if user email exist in the table
    const user = await prisma.user.findUnique({
        where: {email : email}
    });
    if (!user){
        return  res
        .status(401)
        .json({error:"Invalid user email or password"})
    }
    //verify the password
    const isPasswordValid = await bcrypt.compare(password, user.password)
    if(!isPasswordValid){
        return  res.status(401).json({error:"Invalid user email or password"})
    }
    //Generate JWT Token

    const token = generateToken(String(user.id), res)

    
    res.status(201).json({
        status:"success",
        data:{
            user:{
                id:user.id,
                name:user.name,
                email:user.email,
                role:user.role
                },
                token
                }
                })}
const logout = async (req: Request, res: Response) =>{
    res.cookie("jwt","",{
        httpOnly:true,
        expires: new Date(0),
    })
    res.status(200).json({
        status:"success",
        message:"Logged out succesfully"
    })
}
const getProfile = async (req: AuthRequest, res: Response) => {
    try {
        // Данные пользователя уже находятся в req.user благодаря authMiddleware
        const user = req.user;

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Удаляем пароль из объекта перед отправкой
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

const getUsers = async (req: any, res: Response) => {
  try {
    // Извлекаем всех пользователей, исключая поле password для безопасности
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
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

export const deleteUser = async (req: Request, res: Response) => {
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



export {register,login,logout,getProfile, getUsers}