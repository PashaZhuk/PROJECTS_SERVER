import logger from '../utils/logger.js';

const BASE_URL = 'https://smart-sender.a1.by/api';

interface SmsSendResult {
  success: boolean;
  messageId?: number;
  price?: number;
  parts?: number;
  amount?: number;
  error?: { code: number; description: string; parameter?: string };
}

/**
 * Отправка SMS через Smart Sender A1 (A1 Belarus)
 */
export async function sendSms(
  phone: string,
  text: string
): Promise<SmsSendResult> {
  const user = process.env.SMART_SENDER_USER;
  const apikey = process.env.SMART_SENDER_APIKEY;
  const sender = process.env.SMART_SENDER_SENDER || 'support_IPM';

  if (!user || !apikey) {
    logger.error('Smart Sender не настроен: отсутствуют SMART_SENDER_USER или SMART_SENDER_APIKEY');
    return { success: false, error: { code: -1, description: 'Сервис SMS не настроен' } };
  }

  const url = `${BASE_URL}/send/sms`
    + `?user=${encodeURIComponent(user)}`
    + `&apikey=${encodeURIComponent(apikey)}`
    + `&msisdn=${encodeURIComponent(phone)}`
    + `&sender=${encodeURIComponent(sender)}`
    + `&text=${encodeURIComponent(text)}`;

  try {
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();

    if (data.status === true) {
      logger.info('SMS отправлено', {
        messageId: data.message_id,
        phone: phone.replace(/\d{4}$/, '****'),
        price: data.amount,
      });
      return {
        success: true,
        messageId: data.message_id,
        price: data.price,
        parts: data.parts,
        amount: data.amount,
      };
    }

    logger.warn('Ошибка отправки SMS', {
      code: data.error?.code,
      description: data.error?.description,
      parameter: data.error?.parameter,
    });
    return {
      success: false,
      error: {
        code: data.error?.code || 0,
        description: data.error?.description || 'Неизвестная ошибка',
        parameter: data.error?.parameter,
      },
    };
  } catch (err: any) {
    logger.error('Ошибка HTTP при отправке SMS', {
      error: err.message,
      phone: phone.replace(/\d{4}$/, '****'),
    });
    return {
      success: false,
      error: { code: -1, description: `Ошибка сети: ${err.message}` },
    };
  }
}

/**
 * Проверка статуса SMS по message_id
 */
export async function getSmsStatus(messageId: number): Promise<string | null> {
  const user = process.env.SMART_SENDER_USER;
  const apikey = process.env.SMART_SENDER_APIKEY;

  if (!user || !apikey) return null;

  const url = `${BASE_URL}/status/sms`
    + `?user=${encodeURIComponent(user)}`
    + `&apikey=${encodeURIComponent(apikey)}`
    + `&message_id=${messageId}`;

  try {
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();

    if (data.status === true && data.message_status) {
      return data.message_status.name as string; // "Доставлено", "Не доставлено", etc.
    }
    return null;
  } catch {
    return null;
  }
}
