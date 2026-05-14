import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { getNewsList, createNews, deleteNews } from '../services/newsService.js';

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
  sendSuccess(res, undefined, 'Новость удалена');
});
