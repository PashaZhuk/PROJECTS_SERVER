import { Router } from 'express';
import { createProject, getProjects,updateProject } from '../controllers/projectController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Защищаем все роуты проектов авторизацией
router.use(authMiddleware);

// POST /api/projects — создание новой заявки
router.post('/', createProject);

// GET /api/projects — получение списка (фильтрация внутри контроллера)
router.get('/', getProjects);

// PUT /api/projects — обновление конкретного проекта по его id
router.put('/:id', updateProject);

export default router;