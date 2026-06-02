import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { getNewsList, createNews, deleteNews, updateNews } from '../services/newsService.js';
import { logEvent } from '../services/eventLogService.js';

export const listNews = asyncHandler(async (_req: Request, res: Response) => {
  const news = await getNewsList();
  sendSuccess(res, news);
});

export const addNews = asyncHandler(async (req: Request, res: Response) => {
  const { title, link, imageUrl } = req.body || {};
  if (!title || !link) {
    sendError(res, 400, 'Необходимо указать title и link');
    return;
  }
  const item = await createNews({ title, link, imageUrl });
  const userId = (req as any).user?.id;
  logEvent({ action: 'news_added', description: `Добавлена новость: ${title}`, entityType: 'news', entityId: item.id, userId });
  sendSuccess(res, item, 'Новость добавлена');
});

export const removeNews = asyncHandler(async (req: Request, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    sendError(res, 400, 'Некорректный ID');
    return;
  }
  await deleteNews(id);
  const userId = (req as any).user?.id;
  logEvent({ action: 'news_deleted', description: `Удалена новость #${id}`, entityType: 'news', entityId: id, userId });
  sendSuccess(res, undefined, 'Новость удалена');
});

export const editNews = asyncHandler(async (req: Request, res: Response) => {
  const idStr = req.params.id || '';
  const id = parseInt(idStr, 10);
  if (isNaN(id)) { sendError(res, 400, 'Некорректный ID'); return; }
  const { title, link, imageUrl } = req.body || {};
  const userId = (req as any).user?.id;
  const item = await updateNews(id, { title, link, imageUrl });
  logEvent({ action: 'news_edited', description: `Изменена новость: ${title || item.title}`, entityType: 'news', entityId: item.id, userId });
  sendSuccess(res, item, 'Новость обновлена');
});
