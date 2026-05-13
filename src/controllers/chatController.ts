import type { Response } from 'express';
import {
  getProjectMessages as getProjectMessagesService,
  sendMessage as sendMessageService,
  markMessagesAsRead as markMessagesAsReadService,
} from '../services/chatService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const getProjectMessages = asyncHandler(async (req: any, res: Response) => {
  const { projectId } = req.params;
  const messages = await getProjectMessagesService(Number(projectId), req.user.id, req.user.role, req.logMeta);
  sendSuccess(res, messages);
});

export const sendMessage = asyncHandler(async (req: any, res: Response) => {
  const { projectId } = req.params;
  const { text } = req.body;
  const message = await sendMessageService(Number(projectId), text, req.user.id, req.logMeta);
  sendSuccess(res, message, undefined, 201);
});

export const markAsRead = asyncHandler(async (req: any, res: Response) => {
  const { projectId } = req.params;
  const result = await markMessagesAsReadService(Number(projectId), req.user.id, req.logMeta);
  sendSuccess(res, result);
});