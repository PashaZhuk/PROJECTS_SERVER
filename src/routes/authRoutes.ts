import express from 'express';
import { 
  register, login, logout, getProfile, 
  forgotPassword, resetPassword, 
  send2FACode, verify2FACode 
} from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';
import { validate, loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, twoFASendSchema, twoFAVerifySchema } from '../utils/validationSchemas';

const router = express.Router();

router.post('/register', authMiddleware, adminMiddleware, validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/logout', logout);
router.get('/profile', authMiddleware, getProfile);
router.post('/2fa/send', validate(twoFASendSchema), send2FACode);
router.post('/2fa/verify', validate(twoFAVerifySchema), verify2FACode);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

export default router;