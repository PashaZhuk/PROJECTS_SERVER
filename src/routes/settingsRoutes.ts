import { Router } from 'express';
import { getPublicSetting } from '../controllers/settingsController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

router.use(authMiddleware);
router.get('/:key', getPublicSetting);

export default router;
