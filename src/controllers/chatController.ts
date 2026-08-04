import type { Response } from 'express';
import {
  getProjectMessages as getProjectMessagesService,
  sendMessage as sendMessageService,
  markMessagesAsRead as markMessagesAsReadService,
} from '../services/chatService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import type { AuthRequest } from '../types/express.js';

export const getProjectMessages = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params;
  const user = req.user!;
  const messages = await getProjectMessagesService(Number(projectId), user.id, user.role, req.logMeta);
  sendSuccess(res, messages);
});

export const sendMessage = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params;
  const { text } = req.body;
  const user = req.user!;
  const message = await sendMessageService(Number(projectId), text, user.id, user.role, req.logMeta);
  sendSuccess(res, message, undefined, 201);
});

export const markAsRead = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params;
  const user = req.user!;
  const result = await markMessagesAsReadService(Number(projectId), user.id, user.role, req.logMeta);
  sendSuccess(res, result);
});
