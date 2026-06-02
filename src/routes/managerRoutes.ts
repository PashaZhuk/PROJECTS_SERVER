import { Router } from 'express';
import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { managerMiddleware } from '../middleware/managerMiddleware.js';
import { validate, broadcastSchema } from '../utils/validationSchemas.js';
import { getPartners, sendBroadcast } from '../controllers/managerController.js';
import {
  listEquipment,
  getEquipment,
  addEquipment,
  editEquipment,
  removeEquipment,
  listCategories,
} from '../controllers/equipmentController.js';
import { listNews, addNews, removeNews } from '../controllers/newsController.js';
import { listBroadcastLog } from '../controllers/broadcastLogController.js';
import { listEvents } from '../controllers/eventLogController.js';

const router = Router();

router.use(authMiddleware, managerMiddleware);

// Broadcast
router.get('/partners', getPartners);
router.post('/send-broadcast', express.json({ limit: '50mb' }), validate(broadcastSchema), sendBroadcast);

// Equipment
router.get('/equipment', listEquipment);
router.get('/equipment/categories', listCategories);
router.get('/equipment/:id', getEquipment);
router.post('/equipment', addEquipment);
router.put('/equipment/:id', editEquipment);
router.delete('/equipment/:id', removeEquipment);

// News
router.get('/news', listNews);
router.post('/news', addNews);
router.delete('/news/:id', removeNews);

// Broadcast log
router.get('/broadcast-log', listBroadcastLog);

// Events
router.get('/events', listEvents);

export default router;
