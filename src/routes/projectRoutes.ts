import { Router } from 'express';
import { createProject, getProjects, updateProject, updateProjectStatus } from '../controllers/projectController';
import { authMiddleware } from '../middleware/authMiddleware';
import { managerMiddleware } from '../middleware/managerMiddleware';
import { validate, createProjectSchema, updateProjectSchema, updateProjectStatusSchema } from '../utils/validationSchemas';

const router = Router();

router.use(authMiddleware);

router.post('/', validate(createProjectSchema), createProject);
router.get('/', getProjects);
router.put('/:id', validate(updateProjectSchema), updateProject);
router.patch('/:id/status', managerMiddleware, validate(updateProjectStatusSchema), updateProjectStatus);

export default router;