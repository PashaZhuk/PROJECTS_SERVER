import { fetchLogs, fetchLogsRange } from '../services/adminService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const getLogs = asyncHandler(async (req: any, res: any) => {
  const level = req.query.level as string;
  const search = req.query.search as string;
  const limit = parseInt(req.query.limit as string) || 500;
  const date = req.query.date as string;
  const result = await fetchLogs(level, search, limit, date);
  sendSuccess(res, result);
});

export const downloadLogs = asyncHandler(async (req: any, res: any) => {
  const dateFrom = req.query.dateFrom as string;
  const dateTo = req.query.dateTo as string;
  const level = req.query.level as string;

  if (!dateFrom || !dateTo) {
    return res.status(400).json({ success: false, error: 'Укажите dateFrom и dateTo' });
  }

  const logs = await fetchLogsRange(dateFrom, dateTo, level);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="logs-${dateFrom}_${dateTo}.json"`);
  res.json({ success: true, count: logs.length, data: logs });
});