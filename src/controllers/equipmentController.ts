import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../utils/response.js';
import {
  getEquipmentList,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  getEquipmentCategories,
} from '../services/equipmentService.js';

export const listEquipment = asyncHandler(async (req: Request, res: Response) => {
  const { category, status, search, page, perPage } = req.query;
  const result = await getEquipmentList({
    category: category as string,
    status: status as string,
    search: search as string,
    page: parseInt(page as string, 10) || 1,
    perPage: parseInt(perPage as string, 10) || 50,
  });
  sendSuccess(res, result);
});

export const getEquipment = asyncHandler(async (req: Request, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) { sendError(res, 400, 'Некорректный ID'); return; }
  const item = await getEquipmentById(id);
  if (!item) { sendError(res, 404, 'Не найдено'); return; }
  sendSuccess(res, item);
});

export const addEquipment = asyncHandler(async (req: Request, res: Response) => {
  const data = req.body || {};
  const item = await createEquipment(data);
  sendSuccess(res, item, 'Оборудование добавлено');
});

export const editEquipment = asyncHandler(async (req: Request, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) { sendError(res, 400, 'Некорректный ID'); return; }
  const data = req.body || {};
  const item = await updateEquipment(id, data);
  sendSuccess(res, item, 'Оборудование обновлено');
});

export const removeEquipment = asyncHandler(async (req: Request, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) { sendError(res, 400, 'Некорректный ID'); return; }
  await deleteEquipment(id);
  sendSuccess(res, undefined, 'Оборудование удалено');
});

export const listCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await getEquipmentCategories();
  sendSuccess(res, categories);
});
