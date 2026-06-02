import type { Response } from 'express';

interface SuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  timeLeft?: number;
  lockType?: string;
  attemptsLeft?: number;
  errors?: Array<{ path: string; message: string }>;
}

export const sendSuccess = <T>(
  res: Response,
  data?: T,
  message?: string,
  statusCode = 200
) => {
  const body: SuccessResponse<T> = { success: true };
  if (data !== undefined) body.data = data;
  if (message) body.message = message;
  return res.status(statusCode).json(body);
};

export const sendError = (
  res: Response,
  statusCode: number,
  error: string,
  extra?: Partial<Omit<ErrorResponse, 'success' | 'error'>>
) => {
  const body: ErrorResponse = { success: false, error, ...extra };
  return res.status(statusCode).json(body);
};
