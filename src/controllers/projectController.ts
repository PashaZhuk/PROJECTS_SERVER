import type { Response } from 'express';
import {
  createProject as createProjectService,
  getProjects as getProjectsService,
  updateProject as updateProjectService,
  updateProjectStatus as updateProjectStatusService,
} from '../services/projectService.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createProject = asyncHandler(async (req: any, res: Response) => {
  const newProject = await createProjectService(req.body, req.user.id, req.logMeta);
  res.status(201).json({ message: 'Заявка успешно создана и передана на модерацию', projectId: newProject.id });
});

export const getProjects = asyncHandler(async (req: any, res: Response) => {
  const result = await getProjectsService(req.user.id, req.user.role, req.query);
  res.json(result);
});

export const updateProject = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const updatedProject = await updateProjectService(Number(id), req.body, req.user.id, req.user.role, req.logMeta);
  res.json({ message: 'Проект обновлен', project: updatedProject });
});

export const updateProjectStatus = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  const updatedProject = await updateProjectStatusService(Number(id), status, req.user.id, req.user.role, req.logMeta);
  res.json({ message: 'Статус обновлен', project: updatedProject });
});