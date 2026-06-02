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
  const details = [
    item.name ? `Наименование: ${item.name}` : '',
    item.category ? `Категория: ${item.category}` : '',
    item.serialNumber ? `Серийный №: ${item.serialNumber}` : '',
    item.macAddress ? `MAC: ${item.macAddress}` : '',
    item.issuedTo ? `Кому: ${item.issuedTo}` : '',
    item.issuedToWhere ? `Куда: ${item.issuedToWhere}` : '',
    item.status === 'issued' && item.issueDate ? `Выдан: ${item.issueDate}` : '',
  ].filter(Boolean).join(', ');
  logEvent({
    action: 'equipment_added',
    description: `Добавлено: ${item.name}. ${details}`,
    entityType: 'equipment', entityId: item.id, userId,
  });
  sendSuccess(res, item, 'Оборудование добавлено');
});

export const editEquipment = asyncHandler(async (req: Request, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) { sendError(res, 400, 'Некорректный ID'); return; }
  const data = req.body || {};
  
  // Получаем старое значение для сравнения
  const oldItem = await getEquipmentById(id);
  if (!oldItem) { sendError(res, 404, 'Оборудование не найдено'); return; }
  
  const item = await updateEquipment(id, data);
  const userId = (req as any).user?.id;

  // Сравниваем поля и собираем changes
  const changes: string[] = [];
  const fields: Record<string, string> = {
    name: 'Наименование', category: 'Категория', accountingType: 'Тип учёта',
    purpose: 'Назначение', serialNumber: 'Серийный №', macAddress: 'MAC-адрес',
    status: 'Статус', issuedTo: 'Выдано', issuedToWhere: 'Куда выдано',
    issueDate: 'Дата выдачи', comments: 'Комментарий',
  };
  const statusLabels: Record<string, string> = {
    in_stock: 'На складе', issued: 'Выдано', repair: 'Ремонт', written_off: 'Списано',
  };

  for (const [field, label] of Object.entries(fields)) {
    const oldVal = (oldItem as any)[field];
    const newVal = (item as any)[field];
    const oldStr = field === 'status' ? (statusLabels[oldVal] || oldVal) : String(oldVal ?? '—');
    const newStr = field === 'status' ? (statusLabels[newVal] || newVal) : String(newVal ?? '—');
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      changes.push(`${label}: ${oldStr} → ${newStr}`);
    }
  }

  logEvent({
    action: 'equipment_edited',
    description: `Изменено: ${item.name}. ${changes.join('; ') || 'без изменений'}`,
    entityType: 'equipment', entityId: item.id, userId,
  });
  sendSuccess(res, item, 'Оборудование обновлено');
});

export const removeEquipment = asyncHandler(async (req: Request, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) { sendError(res, 400, 'Некорректный ID'); return; }
  const item = await getEquipmentById(id);
  if (!item) { sendError(res, 404, 'Оборудование не найдено'); return; }
  await deleteEquipment(id);
  const userId = (req as any).user?.id;
  logEvent({
    action: 'equipment_deleted',
    description: `Удалено: ${item.name}${item.serialNumber ? ` (SN: ${item.serialNumber})` : ''}${item.macAddress ? `, MAC: ${item.macAddress}` : ''}`,
    entityType: 'equipment', entityId: id, userId,
  });
  sendSuccess(res, undefined, 'Оборудование удалено');
});

export const listCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await getEquipmentCategories();
  sendSuccess(res, categories);
});
