import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  register, login, logout, getProfile,
  forgotPassword, resetPassword,
  send2FACode, verify2FACode,
  refresh,
} from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';
import { validate, loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, twoFASendSchema, twoFAVerifySchema } from '../utils/validationSchemas';

const router = express.Router();

router.post('/register', authMiddleware, adminMiddleware, validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/logout', logout);
router.get('/profile', authMiddleware, getProfile);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);
router.post('/refresh', refresh);

// Rate limit для 2FA: 3 запроса/мин на отправку (app-level блокировка для verify)
const twoFASendLimiter = rateLimit({ windowMs: 60 * 1000, max: 3, message: { success: false, error: 'Слишком много запросов кода. Подождите минуту.' } });

router.post('/2fa/send', twoFASendLimiter, validate(twoFASendSchema), send2FACode);
router.post('/2fa/verify', validate(twoFAVerifySchema), verify2FACode);

export default router;