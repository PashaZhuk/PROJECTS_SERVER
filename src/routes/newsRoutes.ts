import { Router } from 'express';
import { getNewsList } from '../services/newsService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

const router = Router();

// Public: список новостей (без авторизации)
router.get('/', asyncHandler(async (_req, res) => {
  const news = await getNewsList();
  sendSuccess(res, news);
}));

export default router;
