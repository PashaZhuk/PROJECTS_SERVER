import { Router } from 'express';
import { getPublicSetting } from '../controllers/settingsController.js';

const router = Router();

router.get('/:key', getPublicSetting);

export default router;
