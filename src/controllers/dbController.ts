import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../utils/response.js';
import {
  getTables,
  getTableData,
  updateTableRow,
} from '../services/dbService.js';

/** GET /api/admin/db/tables — список таблиц с колонками */
export const listTables = asyncHandler(async (_req: Request, res: Response) => {
  const tables = await getTables();
  sendSuccess(res, tables);
});

/** GET /api/admin/db/tables/:tableName — данные таблицы с пагинацией */
export const readTable = asyncHandler(async (req: Request, res: Response) => {
  const tableName = req.params.tableName || '';
  const pageStr = req.query.page as string | undefined;
  const perPageStr = req.query.perPage as string | undefined;
  const searchStr = req.query.search as string | undefined;
  const page = parseInt(pageStr || '1', 10) || 1;
  const perPage = parseInt(perPageStr || '25', 10) || 25;
  const search = searchStr || '';

  if (!tableName) {
    sendError(res, 400, 'Не указано имя таблицы');
    return;
  }

  try {
    const result = await getTableData(tableName, { page, perPage, search });
    sendSuccess(res, result);
  } catch (err: any) {
    sendError(res, 400, err.message || 'Ошибка загрузки таблицы');
  }
});

/** PUT /api/admin/db/tables/:tableName/:id — обновление строки */
export const updateRow = asyncHandler(async (req: Request, res: Response) => {
  const tableName = req.params.tableName || '';
  const idStr = req.params.id || '';
  const rowId = parseInt(idStr, 10);

  if (isNaN(rowId)) {
    sendError(res, 400, 'Некорректный ID');
    return;
  }

  try {
    await updateTableRow(tableName, rowId, req.body);
    sendSuccess(res, undefined, 'Строка обновлена');
  } catch (err: any) {
    sendError(res, 400, err.message || 'Ошибка обновления');
  }
});
