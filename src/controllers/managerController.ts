import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { prisma } from '../config/db.js';
import { sendEmail } from '../services/emailService.js';
import { sendSuccess, sendError } from '../utils/response.js';

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

  sendSuccess(res, partners);
});

export const sendBroadcast = asyncHandler(async (req: Request, res: Response) => {
  const { recipientIds, subject, message, attachments } = req.body;
  // Данные уже провалидированы broadcastSchema в middleware

  const recipients = await prisma.user.findMany({
    where: {
      id: { in: recipientIds },
      role: 'USER',
    },
    select: { id: true, email: true, companyName: true },
  });

  if (recipients.length === 0) {
    sendError(res, 400, 'Нет получателей с email');
    return;
  }

  let sent = 0;
  const failed: Array<{ id: number; email: string; error: string }> = [];

  const results = await Promise.allSettled(
    recipients.map(async (recipient) => {
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
    })
  );

  sendSuccess(res, {
    sent,
    failed: failed.length,
    failedDetails: failed.length > 0 ? failed : undefined,
  });
});