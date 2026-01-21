import express from 'express'
import { register, login, logout, getProfile,getUsers, deleteUser} from '../../src/controllers/authController';
import  {authMiddleware} from '../middleware/authMiddleware'
import { adminMiddleware } from '../middleware/adminMiddleware';
const router = express.Router();

router.post('/register', authMiddleware, adminMiddleware, register)
router.post('/login', login)
router.post('/logout', logout)
router.get('/profile', authMiddleware, getProfile)
router.get('/users', authMiddleware, adminMiddleware, getUsers)
router.delete('/users/:id', authMiddleware, adminMiddleware, deleteUser)



export default router