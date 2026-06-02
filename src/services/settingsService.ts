import { prisma } from '../config/db.js';

export const getSetting = async (key: string) => {
  const record = await prisma.siteSetting.findUnique({ where: { key } });
  return record?.value ?? null;
};

export const getAllSettings = async () => {
  const records = await prisma.siteSetting.findMany();
  const result: Record<string, unknown> = {};
  for (const r of records) {
    result[r.key] = r.value;
  }
  return result;
};

export const upsertSetting = async (key: string, value: unknown) => {
  const record = await prisma.siteSetting.upsert({
    where: { key },
    create: { key, value: value as any },
    update: { value: value as any },
  });
  return record.value;
};
