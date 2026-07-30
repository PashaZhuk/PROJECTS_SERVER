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

export interface OneCFinanceResponse {
  unp: string;
  partnerName: string;
  totalOpenShipped: number;
  totalOverdue: number;
  totalPrepayment: number;
  dataAsOf: string;
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

/** Распарсить ответ 1С для partner: принимает объект или массив с одним элементом */
function parsePartnerResponse(body: unknown): OneCPartnerResponse {
  if (!body || typeof body !== 'object') {
    throw new AppError(502, 'Invalid response format from 1C');
  }

  const data: Record<string, unknown> = Array.isArray(body) ? body[0] as Record<string, unknown> : body as Record<string, unknown>;

  return {
    name: typeof data.name === 'string' ? data.name : '',
    unp: typeof data.unp === 'string' ? data.unp : '',
    phoneB2B: typeof data.phoneB2B === 'string' ? data.phoneB2B : '',
    emailB2B: typeof data.emailB2B === 'string' ? data.emailB2B : '',
  };
}

/** Распарсить ответ 1С для finance: принимает объект или массив с одним элементом */
function parseFinanceResponse(body: unknown): OneCFinanceResponse {
  if (!body || typeof body !== 'object') {
    throw new AppError(502, 'Invalid response format from 1C');
  }

  const data: Record<string, unknown> = Array.isArray(body) ? body[0] as Record<string, unknown> : body as Record<string, unknown>;

  return {
    unp: typeof data.unp === 'string' ? data.unp : '',
    partnerName: typeof data.partnerName === 'string' ? data.partnerName : '',
    totalOpenShipped: typeof data.totalOpenShipped === 'number' ? data.totalOpenShipped : 0,
    totalOverdue: typeof data.totalOverdue === 'number' ? data.totalOverdue : 0,
    totalPrepayment: typeof data.totalPrepayment === 'number' ? data.totalPrepayment : 0,
    dataAsOf: typeof data.dataAsOf === 'string' ? data.dataAsOf : new Date().toISOString(),
  };
}

// --- Helpers для запросов к 1С ---

async function fetchFromOneC<T>(url: string, parser: (body: unknown) => T): Promise<T> {
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

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AppError(502, 'Invalid response from 1C (not JSON)');
  }

  if (!response.ok) {
    handleOneCError(response.status, body);
  }

  return parser(body);
}

// --- Main ---

/**
 * Получить данные партнёра по УНП из 1С.
 */
export async function getPartnerByUnp(unp: string): Promise<OneCPartnerResponse> {
  const url = `${ONEC_BASE_URL}/partner?unp=${encodeURIComponent(unp)}`;
  return fetchFromOneC(url, parsePartnerResponse);
}

/**
 * Получить финансовую информацию партнёра из 1С.
 */
export async function getPartnerFinance(unp: string): Promise<OneCFinanceResponse> {
  const url = `${ONEC_BASE_URL}/partner-finance?unp=${encodeURIComponent(unp)}`;
  return fetchFromOneC(url, parseFinanceResponse);
}

// --- Reconciliation statement ---

export interface StatementResult {
  /** Бинарное содержимое файла */
  data: ArrayBuffer;
  /** Content-Type из ответа 1С */
  contentType: string;
  /** Предложенное имя файла */
  filename: string;
}

/**
 * Получить акт сверки из 1С.
 *
 * @param unp — УНП партнёра
 * @param year — опционально: год для квартального акта
 * @param quarter — опционально: номер квартала (1-4)
 */
export async function getReconciliationStatement(
  unp: string,
  year?: number,
  quarter?: number,
): Promise<StatementResult> {
  let url = `${ONEC_BASE_URL}/reconciliation-statement?unp=${encodeURIComponent(unp)}`;
  if (year !== undefined && quarter !== undefined) {
    url += `&year=${year}&quarter=${quarter}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: basicAuthHeader(),
      signal: AbortSignal.timeout(30_000), // 30 сек — файл может генерироваться
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

  if (!response.ok) {
    // Пробуем прочитать тело ошибки
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      throw new AppError(response.status, '1C error');
    }
    handleOneCError(response.status, errorBody);
  }

  const data = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const disposition = response.headers.get('content-disposition');
  let filename = 'akt-sverki';

  if (disposition) {
    const match = disposition.match(/filename\*?=(?:UTF-8'')?([^;\s]+)/i);
    if (match) {
      filename = decodeURIComponent(match[1]);
    }
  }

  // Если расширения нет — добавляем по content-type
  if (!filename.includes('.')) {
    const extMap: Record<string, string> = {
      'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/msword': '.doc',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    };
    filename += extMap[contentType] || '.bin';
  }

  return { data, contentType, filename };
}
