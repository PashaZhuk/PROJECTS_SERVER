import { type Response } from 'express';
import { prisma } from '../config/db.js';
import { emitStatsUpdate } from '../utils/socketHelpers.js';

export const createProject = async (req: any, res: Response) => {
  try {
    const { 
      formType, 
      customerName, 
      customerInn, 
      purchaseMethod, 
      executionDate, 
      ...otherData 
    } = req.body;

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

    const newProject = await prisma.project.create({
      data: {
        number: null, 
        status: 'PENDING',
        formType,
        customerName,
        customerInn,
        purchaseMethod,
        executionDate: executionDate ? new Date(executionDate) : null,
        partnerId: Number(req.user.id),
        dynamicData: otherData 
      }
    });

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

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const search = (req.query.search as string || '').trim();
    const skip = (page - 1) * limit;

    let where: any = {};

    // Ограничение по роли
    if (userRole === 'USER') {
      where.partnerId = userId;
    }

    // ИСПРАВЛЕННАЯ ЛОГИКА ПОИСКА
    if (search) {
      const cleanSearch = search.replace(/^PRJ-/i, ''); // Убираем префикс если он есть
      const searchId = parseInt(cleanSearch);
      const isSearchNumeric = /^\d+$/.test(cleanSearch);

      where = {
        ...where,
        OR: [
          // 1. Поиск по имени заказчика (всегда)
          { customerName: { contains: search, mode: 'insensitive' } },
          
          // 2. Поиск по ID (только если введено число или PRJ-число)
          ...(isSearchNumeric && !isNaN(searchId) ? [{ id: searchId }] : []),

          // 3. Поиск по партнеру (только для менеджеров)
          ...(userRole === 'MANAGER' || userRole === 'ADMIN' ? [
            { partner: { companyName: { contains: search, mode: 'insensitive' } } },
            { partner: { name: { contains: search, mode: 'insensitive' } } }
          ] : [])
          
          // ЗАМЕТКА: поиск по customerInn удален намеренно, чтобы исключить лишний шум
        ]
      };
    }

    const [projects, totalCount] = await Promise.all([
      prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          partner: { select: { id: true, name: true, companyName: true } },
          messages: {
            where: { isRead: false, senderId: { not: userId } },
            take: 1
          }
        }
      }),
      prisma.project.count({ where })
    ]);

    const projectsWithBadge = projects.map((p: any) => ({
      ...p,
      hasUnread: p.messages.length > 0,
      messages: undefined 
    }));

    res.json({
      projects: projectsWithBadge,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      totalCount
    });

  } catch (error) {
    console.error('Ошибка в getProjects:', error);
    res.status(500).json({ error: "Ошибка сервера при получении списка" });
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

    const project = await prisma.project.findUnique({
      where: { id: Number(id) }
    });

    if (!project) return res.status(404).json({ error: "Проект не найден" });

    if (project.partnerId !== req.user.id && req.user.role !== 'MANAGER') {
      return res.status(403).json({ error: "Доступ запрещен" });
    }

    const updatedProject = await prisma.project.update({
      where: { id: Number(id) },
      data: {
        formType,
        customerName,
        customerInn,
        purchaseMethod,
        executionDate: executionDate ? new Date(executionDate) : null,
        dynamicData: otherData,
        updatedAt: new Date()
      }
    });

    res.json({ message: "Проект обновлен", project: updatedProject });
  } catch (error) {
    res.status(500).json({ error: "Ошибка при обновлении" });
  }
};

export const updateProjectStatus = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (req.user.role !== 'MANAGER' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Недостаточно прав" });
    }

    const updatedProject = await prisma.project.update({
      where: { id: Number(id) },
      data: { 
        status,
        lastEditorId: req.user.id, 
        updatedAt: new Date()
      },
      include: {
        partner: { select: { name: true, companyName: true, id: true } },
        lastEditor: { select: { name: true } }
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('project_status_changed', updatedProject);
      io.to(`user_${updatedProject.partnerId}`).emit('project_status_changed', updatedProject);
      await emitStatsUpdate(io);
    }

    res.json({ message: "Статус обновлен", project: updatedProject });
  } catch (error) {
    res.status(500).json({ error: "Ошибка смены статуса" });
  }
};