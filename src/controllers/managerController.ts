import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { prisma } from '../config/db.js';
import { sendEmail } from '../services/emailService.js';

export const getPartners = asyncHandler(async (req: Request, res: Response) => {
  const partners = await prisma.user.findMany({
    where: { role: 'USER' },
    select: {
      id: true,
      email: true,
      companyName: true,
      unp: true,
      name: true,
    },
    orderBy: { companyName: 'asc' },
  });

  res.json({ success: true, data: partners });
});

export const sendBroadcast = asyncHandler(async (req: Request, res: Response) => {
  const { recipientIds, subject, message, attachments } = req.body;

  if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
    res.status(400).json({ error: 'Не выбраны получатели' });
    return;
  }

  if (!subject || !message) {
    res.status(400).json({ error: 'Тема и сообщение обязательны' });
    return;
  }

  const recipients = await prisma.user.findMany({
    where: {
      id: { in: recipientIds },
      role: 'USER',
    },
    select: { id: true, email: true, companyName: true },
  });

  if (recipients.length === 0) {
    res.status(400).json({ error: 'Нет получателей с email' });
    return;
  }

  let sent = 0;
  const failed: Array<{ id: number; email: string; error: string }> = [];

  for (const recipient of recipients) {
    try {
      await sendEmail({
        to: recipient.email!,
        subject,
        html: message,
        attachments: attachments
          ? attachments.map((att: any) => ({
              filename: att.filename,
              content: att.content,
              encoding: att.encoding || 'base64',
            }))
          : undefined,
      });
      sent++;
    } catch (err: any) {
      failed.push({ id: recipient.id, email: recipient.email!, error: err.message });
    }
  }

  res.json({
    success: true,
    data: {
      sent,
      failed: failed.length,
      failedDetails: failed.length > 0 ? failed : undefined,
    },
  });
});