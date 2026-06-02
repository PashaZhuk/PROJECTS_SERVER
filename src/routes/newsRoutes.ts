import { Router } from 'express';
import { getNewsList } from '../services/newsService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

router.use(authMiddleware);
router.get('/', asyncHandler(async (_req, res) => {
  const news = await getNewsList();
  sendSuccess(res, news);
}));

export default router;
