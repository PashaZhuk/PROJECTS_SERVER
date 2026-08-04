import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { getNewsList, createNews, deleteNews, updateNews } from '../services/newsService.js';
import { logEvent } from '../services/eventLogService.js';
import { NewsCategory } from '../../generated/prisma/enums.js';
import type { AuthRequest } from '../types/express.js';

const VALID_CATEGORIES = ['NEWS', 'NOMENCLATURE', 'DEMO'] as const;

function parseCategory(val: unknown): NewsCategory | undefined {
  if (typeof val === 'string' && VALID_CATEGORIES.includes(val as any)) {
    return val as NewsCategory;
  }
  return undefined;
}

/** GET /api/news?category=NEWS|NOMENCLATURE|DEMO — публичный (нужен auth) */
export const listNews = asyncHandler(async (req: AuthRequest, res: Response) => {
  const category = parseCategory(req.query.category);
  const news = await getNewsList(category);
  sendSuccess(res, news);
});

/** POST /api/manager/news — создать (manager/admin) */
export const addNews = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { title, content, link, category } = req.body || {};
  if (!title || !content) {
    sendError(res, 400, 'Необходимо указать title и content');
    return;
  }
  const item = await createNews({
    title,
    content,
    link: link || undefined,
    category: parseCategory(category),
  });
  const userId = req.user!.id;
  logEvent({
    action: 'news_added',
    description: `Добавлена новость: ${title}`,
    entityType: 'news',
    entityId: item.id,
    userId,
  });
  sendSuccess(res, item, 'Новость добавлена');
});

/** DELETE /api/manager/news/:id — удалить (manager/admin) */
export const removeNews = asyncHandler(async (req: AuthRequest, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    sendError(res, 400, 'Некорректный ID');
    return;
  }
  await deleteNews(id);
  const userId = req.user!.id;
  logEvent({
    action: 'news_deleted',
    description: `Удалена новость #${id}`,
    entityType: 'news',
    entityId: id,
    userId,
  });
  sendSuccess(res, undefined, 'Новость удалена');
});

/** PUT /api/manager/news/:id — редактировать (manager/admin) */
export const editNews = asyncHandler(async (req: AuthRequest, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    sendError(res, 400, 'Некорректный ID');
    return;
  }
  const { title, content, link, category } = req.body || {};
  if (title !== undefined && !title) {
    sendError(res, 400, 'title не может быть пустым');
    return;
  }
  if (content !== undefined && !content) {
    sendError(res, 400, 'content не может быть пустым');
    return;
  }
  const userId = req.user!.id;
  const item = await updateNews(id, {
    title,
    content,
    link: link || undefined,
    category: parseCategory(category),
  });
  logEvent({
    action: 'news_edited',
    description: `Изменена новость: ${title || item.title}`,
    entityType: 'news',
    entityId: item.id,
    userId,
  });
  sendSuccess(res, item, 'Новость обновлена');
});
