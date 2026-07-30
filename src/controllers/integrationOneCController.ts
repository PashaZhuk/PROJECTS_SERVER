import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPartnerByUnp } from '../services/integrationOneCService.js';
import { sendSuccess } from '../utils/response.js';

export const getPartner = asyncHandler(async (req: Request, res: Response) => {
  const { unp } = req.query;
  const data = await getPartnerByUnp(unp as string);
  sendSuccess(res, data);
});
