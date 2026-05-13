import { Router } from 'express';
import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { managerMiddleware } from '../middleware/managerMiddleware.js';
import { validate, broadcastSchema } from '../utils/validationSchemas.js';
import { getPartners, sendBroadcast } from '../controllers/managerController.js';

const router = Router();

router.use(authMiddleware, managerMiddleware);

router.get('/partners', getPartners);
router.post('/send-broadcast', express.json({ limit: '50mb' }), validate(broadcastSchema), sendBroadcast);

export default router;