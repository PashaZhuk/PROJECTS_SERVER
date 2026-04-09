import express from 'express'
import { register, login, logout, getProfile} from '../../src/controllers/authController';
import  {authMiddleware} from '../middleware/authMiddleware'
import { adminMiddleware } from '../middleware/adminMiddleware';
const router = express.Router();

router.post('/register', authMiddleware, adminMiddleware, register)
router.post('/login', login)
router.post('/logout', authMiddleware, logout)
router.get('/profile', authMiddleware, getProfile)


export default router