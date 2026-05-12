import { Router } from 'express';
import { getProjectMessages, sendMessage, markAsRead } from '../controllers/chatController';
import { authMiddleware } from '../middleware/authMiddleware';
import { validate, sendMessageSchema } from '../utils/validationSchemas';

const router = Router();

router.get('/:projectId/messages', authMiddleware, getProjectMessages);
router.post('/:projectId/messages', authMiddleware, validate(sendMessageSchema), sendMessage);
router.patch('/:projectId/read', authMiddleware, markAsRead);

export default router;