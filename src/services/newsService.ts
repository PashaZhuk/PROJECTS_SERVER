import { prisma } from '../config/db.js';

export async function getNewsList() {
  return prisma.news.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createNews(data: { title: string; link: string; imageUrl?: string }) {
  return prisma.news.create({ data });
}

export async function deleteNews(id: number) {
  return prisma.news.delete({ where: { id } });
}
