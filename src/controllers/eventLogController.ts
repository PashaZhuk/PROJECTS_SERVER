import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getEventLog } from '../services/eventLogService.js';

export const listEvents = asyncHandler(async (_req: Request, res: Response) => {
  const events = await getEventLog();
  sendSuccess(res, events);
});
