import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { managerMiddleware } from '../middleware/managerMiddleware.js';
import { getPartners, sendBroadcast } from '../controllers/managerController.js';

const router = Router();

router.use(authMiddleware, managerMiddleware);

router.get('/partners', getPartners);
router.post('/send-broadcast', sendBroadcast);

export default router;