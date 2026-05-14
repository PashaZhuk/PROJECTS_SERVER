import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';
import { getLogs } from '../controllers/adminController';
import {
  getAllAdminSettings,
  getAdminSetting,
  updateSetting,
} from '../controllers/settingsController';
import {
  listTables,
  readTable,
  updateRow,
} from '../controllers/dbController';

const router = Router();

router.use(authMiddleware, adminMiddleware);
router.get('/logs', getLogs);
router.get('/settings', getAllAdminSettings);
router.get('/settings/:key', getAdminSetting);
router.put('/settings/:key', updateSetting);

// DB Browser
router.get('/db/tables', listTables);
router.get('/db/tables/:tableName', readTable);
router.put('/db/tables/:tableName/:id', updateRow);

export default router;