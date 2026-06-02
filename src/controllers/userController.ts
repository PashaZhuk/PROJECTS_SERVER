import type { Request, Response } from 'express';
import { getUsersList, deleteUserById, toggleBlockUser, changeUserPassword, getAdminStatsService } from '../services/userService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { emitStatsUpdate } from '../services/statsService.js';
import { sendSuccess } from '../utils/response.js';

export const getUsers = asyncHandler(async (req: any, res: Response) => {
  const { page = 1, limit = 10, search = '', role = '' } = req.query;
  const result = await getUsersList({ page: Number(page), limit: Number(limit), search: String(search), role: String(role) });
  sendSuccess(res, result);
});

export const deleteUser = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  await deleteUserById(Number(id), req.user.id, req.logMeta);
  await emitStatsUpdate();
  sendSuccess(res, undefined, 'Пользователь успешно удален');
});

export const toggleBlock = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const { message, isBlocked } = await toggleBlockUser(Number(id), req.user.id, req.logMeta);
  sendSuccess(res, { isBlocked }, message);
});

export const changeDefaultPassword = asyncHandler(async (req: any, res: Response) => {
  const { newPassword } = req.body;
  await changeUserPassword(req.user.id, newPassword, req.logMeta);
  sendSuccess(res);
});

export const getAdminStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await getAdminStatsService();
  sendSuccess(res, stats);
});