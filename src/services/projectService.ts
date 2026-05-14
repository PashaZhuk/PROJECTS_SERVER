import { prisma } from '../config/db.js';
import { ProjectStatus } from '../../generated/prisma/enums.js';
import { emitStatsUpdate, getIo } from './statsService.js';
import { AppError } from '../utils/AppError.js';
import logger from '../utils/logger.js';
import { logEvent } from './eventLogService.js';

export const createProject = async (data: any, userId: number, logMeta?: any) => {
  const { formType, customerName, customerInn, purchaseMethod, executionDate, ...otherData } = data;

  const existingProject = await prisma.project.findFirst({
    where: { customerInn, status: { in: ['PENDING', 'APPROVED', 'IN_PROGRESS'] as ProjectStatus[] } }
  });
  if (existingProject) throw new AppError(400, 'Проект с данным УНП заказчика уже зарегистрирован и находится в обработке.');

  const newProject = await prisma.project.create({
    data: {
      number: null,
      status: ProjectStatus.PENDING,
      formType,
      customerName,
      customerInn,
      purchaseMethod,
      executionDate: executionDate ? new Date(executionDate) : null,
      partnerId: Number(userId),
      dynamicData: otherData
    },
    include: { partner: { select: { id: true, name: true, companyName: true } } }
  });

  const io = getIo();
  if (io) {
    io.to(`user_${userId}`).emit('project_created', newProject);
    io.to('admin_room').emit('project_created', newProject);
  }
  logger.info('Project created', { projectId: newProject.id, customerName, customerInn, userId, ...logMeta });
  return newProject;
};

export const getProjects = async (userId: number, userRole: string, query: any) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.max(1, parseInt(query.limit) || 10);
  const search = (query.search || '').trim();
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
  return { projects: processedProjects, totalPages: Math.ceil(totalCount / limit), currentPage: page, totalCount };
};

export const updateProject = async (id: number, data: any, userId: number, userRole: string, logMeta?: any) => {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw new AppError(404, 'Проект не найден');
  if (project.partnerId !== userId && userRole !== 'MANAGER') throw new AppError(403, 'Доступ запрещен');
  const { formType, customerName, customerInn, purchaseMethod, executionDate, ...otherData } = data;
  const updatedProject = await prisma.project.update({
    where: { id },
    data: {
      formType, customerName, customerInn, purchaseMethod,
      executionDate: executionDate ? new Date(executionDate) : null,
      dynamicData: otherData,
      updatedAt: new Date()
    },
    include: { partner: { select: { id: true, name: true, companyName: true } } }
  });
  const io = getIo();
  if (io) {
    io.to(`user_${userId}`).emit('project_updated', updatedProject);
    io.to('admin_room').emit('project_updated', updatedProject);
  }
  logger.info('Project updated', { projectId: id, userId, ...logMeta });
  return updatedProject;
};

export const updateProjectStatus = async (id: number, status: string, userId: number, userRole: string, logMeta?: any) => {
  if (userRole !== 'MANAGER' && userRole !== 'ADMIN') throw new AppError(403, 'Недостаточно прав');
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw new AppError(404, 'Проект не найден');
  if (!Object.values(ProjectStatus).includes(status as ProjectStatus)) throw new AppError(400, 'Недопустимый статус');
  const validStatus = status as ProjectStatus;
  const oldStatus = project.status;
  const updatedProject = await prisma.project.update({
    where: { id },
    data: { status: validStatus, lastEditorId: userId, updatedAt: new Date() },
    include: { partner: { select: { name: true, companyName: true, id: true } }, lastEditor: { select: { name: true } } }
  });
  const io = getIo();
  if (io) {
    io.to('admin_room').emit('project_status_changed', updatedProject);
    io.to(`user_${updatedProject.partnerId}`).emit('project_status_changed', updatedProject);
    await emitStatsUpdate();
  }
  logger.info('Project status changed', { projectId: id, oldStatus, newStatus: status, userId, ...logMeta });
  const statusLabels: Record<string, string> = {
    PENDING: 'На проверке', IN_PROGRESS: 'В работе', APPROVED: 'Одобрен',
    REJECTED: 'Отклонён', REVISION: 'На доработке', CLOSED: 'Закрыт',
  };
  logEvent({
    action: 'status_changed',
    description: `Проект #${id}: ${statusLabels[oldStatus] || oldStatus} → ${statusLabels[validStatus] || validStatus} (${updatedProject.partner?.companyName || updatedProject.partner?.name || ''})`,
    entityType: 'project', entityId: id, userId,
  });
  return updatedProject;
};