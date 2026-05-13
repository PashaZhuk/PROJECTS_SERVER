import type { Response } from 'express';
import {
  createProject as createProjectService,
  getProjects as getProjectsService,
  updateProject as updateProjectService,
  updateProjectStatus as updateProjectStatusService,
} from '../services/projectService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const createProject = asyncHandler(async (req: any, res: Response) => {
  const newProject = await createProjectService(req.body, req.user.id, req.logMeta);
  sendSuccess(res, { projectId: newProject.id }, 'Заявка успешно создана и передана на модерацию', 201);
});

export const getProjects = asyncHandler(async (req: any, res: Response) => {
  const result = await getProjectsService(req.user.id, req.user.role, req.query);
  sendSuccess(res, result);
});

export const updateProject = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const updatedProject = await updateProjectService(Number(id), req.body, req.user.id, req.user.role, req.logMeta);
  sendSuccess(res, { project: updatedProject }, 'Проект обновлен');
});

export const updateProjectStatus = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  const updatedProject = await updateProjectStatusService(Number(id), status, req.user.id, req.user.role, req.logMeta);
  sendSuccess(res, { project: updatedProject }, 'Статус обновлен');
});