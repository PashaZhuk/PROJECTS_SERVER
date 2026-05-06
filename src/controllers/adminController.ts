import { fetchLogs } from '../services/adminService.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getLogs = asyncHandler(async (req: any, res: any) => {
  const level = req.query.level as string;
  const search = req.query.search as string;
  const limit = parseInt(req.query.limit as string) || 500;
  const date = req.query.date as string;
  const result = await fetchLogs(level, search, limit, date);
  res.json(result);
});