import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { adminMiddleware } from '../middleware/adminMiddleware.js';
import { getPartner } from '../controllers/integrationOneCController.js';

const router = Router();

// Все роуты интеграции — только для ADMIN
router.use(authMiddleware, adminMiddleware);

// GET /api/integration/partner?unp=123456789
router.get('/partner', getPartner);

export default router;
