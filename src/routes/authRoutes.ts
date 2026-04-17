import express from 'express';
import { 
  register, login, logout, getProfile, 
  forgotPassword, resetPassword, 
  send2FACode, verify2FACode // Импортируем новые функции
} from '../../src/controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';

const router = express.Router();

router.post('/register', authMiddleware, adminMiddleware, register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/profile', authMiddleware, getProfile);

// 2FA Routes (публичные, так как юзер еще не залогинен полноценно)
router.post('/2fa/send', send2FACode);
router.post('/2fa/verify', verify2FACode);

router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;