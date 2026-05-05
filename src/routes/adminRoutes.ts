import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';
import { getLogs } from '../controllers/adminController';

const router = Router();

router.use(authMiddleware, adminMiddleware);
router.get('/logs', getLogs);

export default router;