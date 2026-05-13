import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getSetting, getAllSettings, upsertSetting } from '../services/settingsService.js';

/** Публичный: GET /api/settings/:key */
export const getPublicSetting = asyncHandler(async (req: any, res: any) => {
  const { key } = req.params;
  const value = await getSetting(key);
  if (value === null) {
    return sendSuccess(res, null, 'Настройка не найдена');
  }
  sendSuccess(res, value);
});

/** Админ: GET /api/admin/settings */
export const getAllAdminSettings = asyncHandler(async (_req: any, res: any) => {
  const settings = await getAllSettings();
  sendSuccess(res, settings);
});

/** Админ: GET /api/admin/settings/:key */
export const getAdminSetting = asyncHandler(async (req: any, res: any) => {
  const { key } = req.params;
  const value = await getSetting(key);
  if (value === null) {
    return sendSuccess(res, null, 'Настройка не найдена');
  }
  sendSuccess(res, value);
});

/** Админ: PUT /api/admin/settings/:key */
export const updateSetting = asyncHandler(async (req: any, res: any) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined) {
    return res.status(400).json({ success: false, error: 'Поле value обязательно' });
  }
  const updated = await upsertSetting(key, value);
  sendSuccess(res, updated, 'Настройка сохранена');
});
