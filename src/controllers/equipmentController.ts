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
import { logEvent } from '../services/eventLogService.js';

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
  const userId = (req as any).user?.id;
  logEvent({ action: 'equipment_added', description: `Добавлено оборудование: ${item.name}`, entityType: 'equipment', entityId: item.id, userId });
  sendSuccess(res, item, 'Оборудование добавлено');
});

export const editEquipment = asyncHandler(async (req: Request, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) { sendError(res, 400, 'Некорректный ID'); return; }
  const data = req.body || {};
  const item = await updateEquipment(id, data);
  const userId = (req as any).user?.id;
  logEvent({ action: 'equipment_edited', description: `Изменено оборудование: ${item.name}`, entityType: 'equipment', entityId: item.id, userId });
  sendSuccess(res, item, 'Оборудование обновлено');
});

export const removeEquipment = asyncHandler(async (req: Request, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) { sendError(res, 400, 'Некорректный ID'); return; }
  const item = await getEquipmentById(id);
  await deleteEquipment(id);
  const userId = (req as any).user?.id;
  logEvent({ action: 'equipment_deleted', description: `Удалено оборудование: ${item?.name || id}`, entityType: 'equipment', entityId: id, userId });
  sendSuccess(res, undefined, 'Оборудование удалено');
});

export const listCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await getEquipmentCategories();
  sendSuccess(res, categories);
});
