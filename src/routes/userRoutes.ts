import express from 'express';
import { getUsers, deleteUser, changeDefaultPassword, getAdminStats, toggleBlock } from '../../src/controllers/userController';
import { authMiddleware } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';

const router = express.Router();

router.get('/users', authMiddleware, adminMiddleware, getUsers);
router.delete('/users/:id', authMiddleware, adminMiddleware, deleteUser);
router.patch('/users/:id/block', authMiddleware, adminMiddleware, toggleBlock); // ← новый роут
router.post('/change-password', authMiddleware, changeDefaultPassword);
router.get('/admin/stats', authMiddleware, adminMiddleware, getAdminStats);

export default router;