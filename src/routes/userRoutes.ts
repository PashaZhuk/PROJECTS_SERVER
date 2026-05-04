import express from 'express';
import { getUsers, deleteUser, changeDefaultPassword, getAdminStats, toggleBlock } from '../controllers/userController';
import { authMiddleware } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';
import { validate, changePasswordSchema } from '../utils/validationSchemas';

const router = express.Router();

router.get('/users', authMiddleware, adminMiddleware, getUsers);
router.delete('/users/:id', authMiddleware, adminMiddleware, deleteUser);
router.patch('/users/:id/block', authMiddleware, adminMiddleware, toggleBlock);
router.post('/change-password', authMiddleware, validate(changePasswordSchema), changeDefaultPassword);
router.get('/admin/stats', authMiddleware, adminMiddleware, getAdminStats);

export default router;