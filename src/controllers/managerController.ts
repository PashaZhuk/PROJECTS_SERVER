import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { prisma } from '../config/db.js';
import { sendEmail } from '../services/emailService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { logBroadcast } from '../services/broadcastLogService.js';
import { logEvent } from '../services/eventLogService.js';
import type { AuthRequest } from '../types/express.js';

// B16: санитизация HTML от опасных тегов и атрибутов
const sanitizeHtml = (html: string): string => {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
};

export const getPartners = asyncHandler(async (req: AuthRequest, res: Response) => {
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

export const sendBroadcast = asyncHandler(async (req: AuthRequest, res: Response) => {
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

  await Promise.allSettled(
    recipients.map(async (recipient) => {
      try {
        await sendEmail({
          to: recipient.email!,
          subject,
          html: sanitizeHtml(message),
          attachments: attachments
            ? attachments.map((att: { filename?: string; content?: string; encoding?: string }) => ({
                filename: att.filename,
                content: att.content,
                encoding: att.encoding || 'base64',
              }))
            : undefined,
        });
        sent++;
      } catch (err: unknown) {
        failed.push({ id: recipient.id, email: recipient.email!, error: err instanceof Error ? err.message : 'Ошибка отправки' });
      }
    })
  );

  sendSuccess(res, {
    sent,
    failed: failed.length,
    failedDetails: failed.length > 0 ? failed : undefined,
  });

  // Логируем
  const userId = req.user!.id;
  const status = failed.length > 0 && sent === 0 ? 'error' : 'sent';
  logBroadcast({ subject, message, recipients: recipients.length, status, sentBy: userId });
  logEvent({
    action: 'broadcast_sent', description: `Рассылка "${subject}": ${sent} отправлено, ${failed.length} ошибок`,
    entityType: 'broadcast', userId,
  });
});