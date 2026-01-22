import express from 'express'
import { getUsers, deleteUser, changeDefaultPassword} from '../../src/controllers/userController';
import  {authMiddleware} from '../middleware/authMiddleware'
import { adminMiddleware } from '../middleware/adminMiddleware';
const router = express.Router();

router.get('/users', authMiddleware, adminMiddleware, getUsers)
router.delete('/users/:id', authMiddleware, adminMiddleware, deleteUser)
router.post('/change-password', authMiddleware, changeDefaultPassword)



export default router