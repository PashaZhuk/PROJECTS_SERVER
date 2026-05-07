import { Router } from 'express';
import { getCompaniesList } from '../controllers/companyController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { adminMiddleware } from '../middleware/adminMiddleware.js';

const router = Router();
router.use(authMiddleware, adminMiddleware);
router.get('/', getCompaniesList);

export default router;