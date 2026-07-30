import { AppError } from '../utils/AppError.js';

// --- Config ---
const ONEC_BASE_URL =
  process.env.ONEC_BASE_URL ??
  'http://192.168.85.85:8080/UT_TEST/hs/api/integration';
const ONEC_USER = process.env.ONEC_USER ?? 'B2BAPI';
const ONEC_PASS = process.env.ONEC_PASS ?? '';

// --- Types ---

export interface OneCPartnerResponse {
  name: string;
  unp: string;
  phoneB2B: string;
  emailB2B: string;
}

// --- Helpers ---

function basicAuthHeader(): Record<string, string> {
  const encoded = Buffer.from(`${ONEC_USER}:${ONEC_PASS}`).toString('base64');
  return {
    Authorization: `Basic ${encoded}`,
    'Content-Type': 'application/json',
  };
}

/** Выбросить AppError по HTTP-статусу 1С */
function handleOneCError(status: number, body: unknown): never {
  const msg =
    body && typeof body === 'object' && 'error' in body
      ? String((body as Record<string, unknown>).error)
      : 'Unknown 1C error';

  if (status === 400) throw new AppError(400, msg);
  if (status === 404) throw new AppError(404, msg);
  throw new AppError(status, msg);
}

/** Распарсить ответ 1С: принимает объект или массив с одним элементом */
function parsePartnerResponse(body: unknown): OneCPartnerResponse {
  if (!body || typeof body !== 'object') {
    throw new AppError(502, 'Invalid response format from 1C');
  }

  // 1С может вернуть как объект, так и массив с одним элементом
  let data: Record<string, unknown>;
  if (Array.isArray(body)) {
    if (body.length === 0) {
      throw new AppError(404, 'Partner not found');
    }
    data = body[0] as Record<string, unknown>;
  } else {
    data = body as Record<string, unknown>;
  }

  return {
    name: typeof data.name === 'string' ? data.name : '',
    unp: typeof data.unp === 'string' ? data.unp : '',
    phoneB2B: typeof data.phoneB2B === 'string' ? data.phoneB2B : '',
    emailB2B: typeof data.emailB2B === 'string' ? data.emailB2B : '',
  };
}

// --- Main ---

/**
 * Получить данные партнёра по УНП из 1С.
 *
 * GET /api/integration/partner?unp=
 *
 * @param unp — 9 цифр УНП (уже провалидировано Zod на уровне контроллера)
 * @returns OneCPartnerResponse
 * @throws AppError (400 / 404 / 502)
 */
export async function getPartnerByUnp(unp: string): Promise<OneCPartnerResponse> {
  const url = `${ONEC_BASE_URL}/partner?unp=${encodeURIComponent(unp)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: basicAuthHeader(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    if (err instanceof TypeError && (err as Error).message?.includes('fetch')) {
      throw new AppError(502, '1C server is unavailable');
    }
    if (err instanceof DOMException && (err as Error).name === 'TimeoutError') {
      throw new AppError(502, '1C server timeout');
    }
    throw new AppError(502, `1C connection error: ${(err as Error).message}`);
  }

  // Читаем тело (может быть JSON или HTML ошибки)
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AppError(502, 'Invalid response from 1C (not JSON)');
  }

  if (!response.ok) {
    handleOneCError(response.status, body);
  }

  return parsePartnerResponse(body);
}
