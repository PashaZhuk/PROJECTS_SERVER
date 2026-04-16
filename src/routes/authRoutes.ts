import express from 'express';
import { 
  register, 
  login, 
  logout, 
  getProfile, 
  forgotPassword, 
  resetPassword 
} from '../../src/controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';

const router = express.Router();

router.post('/register', authMiddleware, adminMiddleware, register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/profile', authMiddleware, getProfile);

// Новые роуты для восстановления пароля (не требуют авторизации)
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;