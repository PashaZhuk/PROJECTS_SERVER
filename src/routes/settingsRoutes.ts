import { Router } from 'express';
import { getPublicSetting } from '../controllers/settingsController.js';

const router = Router();

// Публичный роут — без авторизации (для футера, модалки контактов)
router.get('/:key', getPublicSetting);

export default router;
