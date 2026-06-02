import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getEventLog } from '../services/eventLogService.js';

export const listEvents = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 200;
  const action = req.query.action as string | undefined;
  const result = await getEventLog({ page, limit, action });
  sendSuccess(res, result);
});
