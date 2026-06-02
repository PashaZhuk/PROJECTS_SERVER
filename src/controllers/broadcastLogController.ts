import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getBroadcastLog } from '../services/broadcastLogService.js';

export const listBroadcastLog = asyncHandler(async (_req: Request, res: Response) => {
  const logs = await getBroadcastLog();
  sendSuccess(res, logs);
});
