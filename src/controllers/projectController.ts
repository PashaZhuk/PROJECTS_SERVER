import { type Response } from 'express';
import { prisma } from '../config/db.js';

export const createProject = async (req: any, res: Response) => {
  try {
    // Извлекаем основные поля, по которым будем фильтровать и которые нужны для 1С
    // Все остальные поля из конфига попадут в массив otherData благодаря rest-оператору
    const { 
      formType, 
      customerName, 
      customerInn, 
      purchaseMethod, 
      executionDate, 
      ...otherData 
    } = req.body;

    // 1. Проверка на дубликаты по УНП (бизнес-логика защиты проекта)
    const existingProject = await prisma.project.findFirst({
      where: { 
        customerInn, 
        status: { in: ['PENDING', 'APPROVED', 'IN_PROGRESS'] } 
      }
    });

    if (existingProject) {
      return res.status(400).json({ 
        error: "Проект с данным УНП заказчика уже зарегистрирован и находится в обработке." 
      });
    }

    // 2. Создаем запись в нашей базе
    // Поле number оставляем null, так как его присвоит 1С
    const newProject = await prisma.project.create({
      data: {
        number: null, 
        status: 'PENDING',
        formType,
        customerName,
        customerInn,
        purchaseMethod,
        executionDate: executionDate ? new Date(executionDate) : null,
        partnerId: req.user.id,
        dynamicData: otherData // Сохраняем все остальные 20+ полей формы здесь
      }
    });

    // 3. МЕСТО ДЛЯ БУДУЩЕЙ ИНТЕГРАЦИИ С 1С
    // Когда HTTP-сервис 1С будет готов, здесь будет вызов функции:
    // const responseFrom1C = await sendTo1C(newProject);
    console.log(`[Pending 1C] Проект создан в БД, готов к отправке в 1С. ID: ${newProject.id}`);

    res.status(201).json({
      message: "Заявка успешно создана и передана на модерацию",
      projectId: newProject.id
    });

  } catch (error) {
    console.error('Ошибка в projectController (create):', error);
    res.status(500).json({ error: "Внутренняя ошибка сервера при создании проекта" });
  }
};

export const getProjects = async (req: any, res: Response) => {
  try {
    const userId = Number(req.user.id);
    const userRole = req.user.role;
    let projects;

    // Настраиваем подсчет непрочитанных сообщений через _count
    const includeOptions: any = {
      _count: {
        select: {
          messages: {
            where: {
              isRead: false,
              senderId: { not: userId }
            }
          }
        }
      }
    };

    if (userRole === 'MANAGER') {
      projects = await prisma.project.findMany({
        include: { 
          partner: { select: { id: true, name: true, companyName: true } },
          ...includeOptions 
        },
        orderBy: { createdAt: 'desc' }
      });
    } 
    else if (userRole === 'USER') {
      projects = await prisma.project.findMany({
        where: { partnerId: userId },
        include: includeOptions,
        orderBy: { createdAt: 'desc' }
      });
    } 
    else {
      return res.status(403).json({ error: "Доступ ограничен" });
    }

    // ТРАНСФОРМАЦИЯ ДАННЫХ
    const transformedProjects = projects.map((p: any) => {
      // Извлекаем количество из объекта _count, который создает Prisma
      const unreadCount = p._count?.messages || 0;
      
      // На всякий случай оставляем hasUnread для старой логики
      const hasUnread = unreadCount > 0;
      
      // Удаляем служебный объект _count из финального ответа
      const { _count, ...projectData } = p; 
      
      return { 
        ...projectData, 
        unreadCount, // Теперь это число (0, 1, 2...)
        hasUnread 
      };
    });

    res.json(transformedProjects);
  } catch (error) {
    console.error('Ошибка в getProjects:', error);
    res.status(500).json({ error: "Ошибка при получении списка проектов" });
  }
};

export const updateProject = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      formType, 
      customerName, 
      customerInn, 
      purchaseMethod, 
      executionDate, 
      ...otherData 
    } = req.body;

    // Проверяем, существует ли проект и принадлежит ли он этому пользователю
    // (Чтобы один партнер не мог отредактировать проект другого через Postman)
    const project = await prisma.project.findUnique({
      where: { id: Number(id) }
    });

    if (!project) {
      return res.status(404).json({ error: "Проект не найден" });
    }

    if (project.partnerId !== req.user.id && req.user.role !== 'MANAGER') {
      return res.status(403).json({ error: "У вас нет прав на редактирование этого проекта" });
    }

    // Обновляем запись
    const updatedProject = await prisma.project.update({
      where: { id: Number(id) },
      data: {
        formType,
        customerName,
        customerInn,
        purchaseMethod,
        executionDate: executionDate ? new Date(executionDate) : null,
        dynamicData: otherData, // Обновляем все динамические поля
        updatedAt: new Date()   // Prisma обычно делает это сама, но можно указать явно
      }
    });

    res.json({
      message: "Проект успешно обновлен",
      project: updatedProject
    });

  } catch (error) {
    console.error('Ошибка в projectController (update):', error);
    res.status(500).json({ error: "Ошибка при обновлении проекта" });
  }
};

export const updateProjectStatus = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // Ожидаем 'APPROVED' или 'REJECTED'

    // 1. Проверка прав: только менеджер может менять статус
    if (req.user.role !== 'MANAGER') {
      return res.status(403).json({ error: "Только менеджеры могут изменять статус проекта" });
    }

    // 2. Валидация входящего статуса
    const validStatuses = ['APPROVED', 'REJECTED', 'PENDING'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Недопустимый статус проекта" });
    }

    // 3. Проверяем существование проекта
    const project = await prisma.project.findUnique({
      where: { id: Number(id) }
    });

    if (!project) {
      return res.status(404).json({ error: "Проект не найден" });
    }

    // 4. Обновляем статус
    const updatedProject = await prisma.project.update({
      where: { id: Number(id) },
      data: { 
        status,
        updatedAt: new Date()
      }
    });

    // 5. МЕСТО ДЛЯ ЛОГИКИ 1С (при одобрении)
    if (status === 'APPROVED') {
      console.log(`[1C Sync] Проект ${id} одобрен менеджером ${req.user.id}. Отправка данных в 1С...`);
      // Здесь будет вызов: await syncProjectWith1C(updatedProject);
    }

    res.json({
      message: `Статус проекта успешно изменен на ${status}`,
      project: updatedProject
    });

  } catch (error) {
    console.error('Ошибка в updateProjectStatus:', error);
    res.status(500).json({ error: "Ошибка при смене статуса проекта" });
  }
};