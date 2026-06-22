import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { managerMiddleware } from '../middleware/managerMiddleware.js';
import { validate, broadcastSchema, createEquipmentSchema, updateEquipmentSchema } from '../utils/validationSchemas.js';
import { getPartners, sendBroadcast } from '../controllers/managerController.js';
import {
  listEquipment,
  getEquipment,
  addEquipment,
  editEquipment,
  removeEquipment,
  listCategories,
} from '../controllers/equipmentController.js';
import { listNews, addNews, removeNews, editNews } from '../controllers/newsController.js';
import { listBroadcastLog } from '../controllers/broadcastLogController.js';
import { listEvents } from '../controllers/eventLogController.js';

const router = Router();

router.use(authMiddleware, managerMiddleware);

// Broadcast
const broadcastLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 минута
  max: 5,
  message: { success: false, error: 'Слишком много запросов. Попробуйте через минуту.' }
});
router.get('/partners', getPartners);
router.post('/send-broadcast', broadcastLimiter, express.json({ limit: '50mb' }), validate(broadcastSchema), sendBroadcast);

// Equipment
router.get('/equipment', listEquipment);
router.get('/equipment/categories', listCategories);
router.get('/equipment/:id', getEquipment);
router.post('/equipment', validate(createEquipmentSchema), addEquipment);
router.put('/equipment/:id', validate(updateEquipmentSchema), editEquipment);
router.delete('/equipment/:id', removeEquipment);

// News
router.get('/news', listNews);
router.post('/news', addNews);
router.put('/news/:id', editNews);
router.delete('/news/:id', removeNews);

// Broadcast log
router.get('/broadcast-log', listBroadcastLog);

// Events
router.get('/events', listEvents);

export default router;
