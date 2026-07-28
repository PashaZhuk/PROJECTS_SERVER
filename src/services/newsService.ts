import { prisma } from '../config/db.js';
import { NewsCategory } from '../../generated/prisma/enums.js';

export async function getNewsList(category?: NewsCategory) {
  return prisma.news.findMany({
    where: category ? { category } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

export async function createNews(data: {
  title: string;
  content: string;
  link?: string;
  category?: NewsCategory;
}) {
  return prisma.news.create({
    data: {
      title: data.title,
      content: data.content,
      link: data.link || null,
      category: data.category || NewsCategory.NEWS,
    },
  });
}

export async function deleteNews(id: number) {
  return prisma.news.delete({ where: { id } });
}

export async function updateNews(
  id: number,
  data: {
    title?: string;
    content?: string;
    link?: string;
    category?: NewsCategory;
  },
) {
  return prisma.news.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.content !== undefined && { content: data.content }),
      ...(data.link !== undefined && { link: data.link || null }),
      ...(data.category !== undefined && { category: data.category }),
    },
  });
}
