import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPartnerByUnp, getPartnerFinance, getReconciliationStatement } from '../services/integrationOneCService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { partnerQuerySchema } from '../utils/validationSchemas.js';

export const getPartner = asyncHandler(async (req: Request, res: Response) => {
  const parsed = partnerQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid UNP');
  }
  const data = await getPartnerByUnp(parsed.data.unp);
  sendSuccess(res, data);
});

export const getPartnerFinanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const parsed = partnerQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid UNP');
  }
  const data = await getPartnerFinance(parsed.data.unp);
  sendSuccess(res, data);
});

export const getReconciliationStatementHandler = asyncHandler(async (req: Request, res: Response) => {
  const parsed = partnerQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid UNP');
  }

  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
  const quarter = req.query.quarter ? parseInt(req.query.quarter as string, 10) : undefined;

  // Если передан year — quarter обязателен (и наоборот)
  if ((year !== undefined && quarter === undefined) || (year === undefined && quarter !== undefined)) {
    return sendError(res, 400, 'Year and quarter must be provided together');
  }

  const result = await getReconciliationStatement(parsed.data.unp, year, quarter);

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
  res.setHeader('Content-Length', result.data.byteLength);
  res.send(Buffer.from(result.data));
});
