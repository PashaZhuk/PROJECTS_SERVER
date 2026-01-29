import express from 'express'
import { Router } from 'express';
import { getProjectMessages, sendMessage, markAsRead} from '../../src/controllers/chatController';
import { authMiddleware } from '../middleware/authMiddleware';

const router =Router()
router.get('/:projectId/messages', authMiddleware, getProjectMessages);
router.post('/:projectId/messages', authMiddleware, sendMessage);
router.patch('/:projectId/read', authMiddleware, markAsRead);

export default router
