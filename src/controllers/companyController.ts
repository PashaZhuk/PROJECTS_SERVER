import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getCompanies } from '../services/companyService.js';

export const getCompaniesList = asyncHandler(async (req: Request, res: Response) => {
  const { search } = req.query;
  const companies = await getCompanies(search as string);
  res.json({ success: true, data: companies });
});