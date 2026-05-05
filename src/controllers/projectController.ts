import { type Response } from 'express';
import { prisma } from '../config/db.js';
import { emitStatsUpdate } from '../utils/socketHelpers.js';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import logger from '../utils/logger';

export const createProject = asyncHandler(async (req: any, res: Response) => {
  const { formType, customerName, customerInn, purchaseMethod, executionDate, ...otherData } = req.body;

  const existingProject = await prisma.project.findFirst({
    where: { customerInn, status: { in: ['PENDING', 'APPROVED', 'IN_PROGRESS'] } }
  });
  if (existingProject) {
    logger.warn('Attempt to create duplicate project', { 
      customerInn, 
      userId: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      ...req.logMeta 
    });
    throw new AppError(400, "Проект с данным УНП заказчика уже зарегистрирован и находится в обработке.");
  }

  const newProject = await prisma.project.create({
    data: {
      number: null, status: 'PENDING', formType, customerName, customerInn,
      purchaseMethod, executionDate: executionDate ? new Date(executionDate) : null,
      partnerId: Number(req.user.id), dynamicData: otherData
    },
    include: { partner: { select: { id: true, name: true, companyName: true } } }
  });

  const io = req.app.get('io');
  if (io) {
    io.to(`user_${req.user.id}`).emit('project_created', newProject);
    io.to('admin_room').emit('project_created', newProject);
  }
  logger.info('Project created', { 
    projectId: newProject.id, 
    customerName, 
    customerInn, 
    userId: req.user.id,
    email: req.user.email,
    name: req.user.name,
    ...req.logMeta 
  });
  res.status(201).json({ message: "Заявка успешно создана и передана на модерацию", projectId: newProject.id });
});

export const getProjects = asyncHandler(async (req: any, res: Response) => {
  const userId = Number(req.user.id);
  const userRole = req.user.role;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
  const search = (req.query.search as string || '').trim();
  const skip = (page - 1) * limit;

  let where: any = {};
  if (userRole === 'USER') where.partnerId = userId;
  if (search) {
    const cleanSearch = search.replace(/^PRJ-/i, '');
    const searchId = parseInt(cleanSearch);
    const isSearchNumeric = /^\d+$/.test(cleanSearch);
    where = {
      ...where,
      OR: [
        { customerName: { contains: search, mode: 'insensitive' } },
        ...(isSearchNumeric && !isNaN(searchId) ? [{ id: searchId }] : []),
        ...(userRole === 'MANAGER' || userRole === 'ADMIN' ? [
          { partner: { companyName: { contains: search, mode: 'insensitive' } } },
          { partner: { name: { contains: search, mode: 'insensitive' } } }
        ] : [])
      ]
    };
  }

  const [projects, totalCount] = await Promise.all([
    prisma.project.findMany({
      where, skip, take: limit,
      orderBy: { updatedAt: 'desc' },
      include: {
        partner: { select: { id: true, name: true, companyName: true } },
        _count: { select: { messages: { where: { isRead: false, senderId: { not: userId } } } } }
      }
    }),
    prisma.project.count({ where })
  ]);

  const processedProjects = projects.map((p: any) => ({
    ...p,
    unreadCount: p._count.messages,
    hasUnread: p._count.messages > 0,
    _count: undefined
  }));
  res.json({ projects: processedProjects, totalPages: Math.ceil(totalCount / limit), currentPage: page, totalCount });
});

export const updateProject = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const { formType, customerName, customerInn, purchaseMethod, executionDate, ...otherData } = req.body;
  const project = await prisma.project.findUnique({ where: { id: Number(id) } });
  if (!project) throw new AppError(404, "Проект не найден");
  if (project.partnerId !== req.user.id && req.user.role !== 'MANAGER') {
    logger.warn('Unauthorized project update attempt', { 
      projectId: Number(id), 
      userId: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      ...req.logMeta 
    });
    throw new AppError(403, "Доступ запрещен");
  }
  const updatedProject = await prisma.project.update({
    where: { id: Number(id) },
    data: { formType, customerName, customerInn, purchaseMethod, executionDate: executionDate ? new Date(executionDate) : null, dynamicData: otherData, updatedAt: new Date() },
    include: { partner: { select: { id: true, name: true, companyName: true } } }
  });
  const io = req.app.get('io');
  if (io) {
    io.to(`user_${req.user.id}`).emit('project_updated', updatedProject);
    io.to('admin_room').emit('project_updated', updatedProject);
  }
  logger.info('Project updated', { 
    projectId: Number(id), 
    userId: req.user.id,
    email: req.user.email,
    name: req.user.name,
    ...req.logMeta 
  });
  res.json({ message: "Проект обновлен", project: updatedProject });
});

export const updateProjectStatus = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  if (req.user.role !== 'MANAGER' && req.user.role !== 'ADMIN') {
    logger.warn('Unauthorized status change attempt', { 
      projectId: Number(id), 
      userId: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      ...req.logMeta 
    });
    throw new AppError(403, "Недостаточно прав");
  }
  const project = await prisma.project.findUnique({ where: { id: Number(id) } });
  if (!project) throw new AppError(404, "Проект не найден");
  const oldStatus = project.status;
  const updatedProject = await prisma.project.update({
    where: { id: Number(id) },
    data: { status, lastEditorId: req.user.id, updatedAt: new Date() },
    include: { partner: { select: { name: true, companyName: true, id: true } }, lastEditor: { select: { name: true } } }
  });
  const io = req.app.get('io');
  if (io) {
    io.to('admin_room').emit('project_status_changed', updatedProject);
    io.to(`user_${updatedProject.partnerId}`).emit('project_status_changed', updatedProject);
    await emitStatsUpdate(io);
  }
  logger.info('Project status changed', { 
    projectId: Number(id), 
    oldStatus, 
    newStatus: status, 
    userId: req.user.id,
    email: req.user.email,
    name: req.user.name,
    ...req.logMeta 
  });
  res.json({ message: "Статус обновлен", project: updatedProject });
});