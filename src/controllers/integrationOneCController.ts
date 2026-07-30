import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPartnerByUnp } from '../services/integrationOneCService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { partnerQuerySchema } from '../utils/validationSchemas.js';

export const getPartner = asyncHandler(async (req: Request, res: Response) => {
  // Zod-валидация query params
  const parsed = partnerQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid UNP');
  }

  const data = await getPartnerByUnp(parsed.data.unp);
  sendSuccess(res, data);
});
