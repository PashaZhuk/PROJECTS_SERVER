import { Router } from 'express';
import { getNewsList } from '../services/newsService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { NewsCategory } from '../../generated/prisma/enums.js';

const VALID_CATEGORIES = ['NEWS', 'NOMENCLATURE', 'DEMO'] as const;

const router = Router();

router.use(authMiddleware);

router.get('/', asyncHandler(async (req, res) => {
  const cat = req.query.category;
  const category = typeof cat === 'string' && VALID_CATEGORIES.includes(cat as any)
    ? cat as NewsCategory
    : undefined;
  const news = await getNewsList(category);
  sendSuccess(res, news);
}));

export default router;
