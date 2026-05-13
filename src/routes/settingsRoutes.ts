import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { adminMiddleware } from '../middleware/adminMiddleware.js';
import {
  getPublicSetting,
  getAllAdminSettings,
  getAdminSetting,
  updateSetting,
} from '../controllers/settingsController.js';

const router = Router();

// Публичный роут — без авторизации
router.get('/:key', getPublicSetting);

// Админские роуты
router.use(authMiddleware, adminMiddleware);
router.get('/', getAllAdminSettings);
router.get('/:key', getAdminSetting);
router.put('/:key', updateSetting);

export default router;
