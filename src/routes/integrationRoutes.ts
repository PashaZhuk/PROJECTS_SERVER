import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
  getPartner,
  getPartnerFinanceHandler,
  getReconciliationStatementHandler,
} from '../controllers/integrationOneCController.js';

const router = Router();

// Все роуты интеграции — доступны любому авторизованному пользователю
router.use(authMiddleware);

// GET /api/integration/partner?unp=123456789
router.get('/partner', getPartner);

// GET /api/integration/partner-finance?unp=123456789
router.get('/partner-finance', getPartnerFinanceHandler);

// GET /api/integration/reconciliation-statement?unp=123456789[&year=2026&quarter=2]
router.get('/reconciliation-statement', getReconciliationStatementHandler);

export default router;
