import { z } from 'zod';

// ----------------------
// USER / AUTH SCHEMAS
// ----------------------

export const loginSchema = z.object({
  email: z.string().regex(/@/, 'Некорректный email'),
  password: z.string().min(1, 'Пароль обязателен'),
});

export const registerSchema = z.object({
  email: z.string().regex(/@/, 'Некорректный email'),
  password: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
  name: z.string().optional(),
  role: z.enum(['USER', 'MANAGER', 'ADMIN']).optional(),
  companyName: z.string().optional(),
  unp: z.string().optional(),
  phone: z.string().regex(/^\+375\d{9}$/, 'Формат: +375XXXXXXXXX'),
}).superRefine((data, ctx) => {
  if (data.role === 'MANAGER' && !data.name) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'Для менеджера обязательно ФИО' });
  }
  if (data.role === 'USER' && (!data.companyName || !data.unp)) {
    ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Для партнера обязательны название компании и УНП' });
  }
});

// B12: currentPassword обязателен — контроллер уже использует req.body.currentPassword
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Текущий пароль обязателен'),
  newPassword: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
});

// Принудительная смена пароля (первый вход, mustChangePassword=true):
// текущий пароль НЕ запрашивается — юзер логинился с временным паролем от админа.
// Отдельная схема от changePasswordSchema (B12 добавил currentPassword только для auth/change-password).
export const forceChangePasswordSchema = z.object({
  newPassword: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().regex(/@/, 'Некорректный email'),
});

export const resetPasswordSchema = z.object({
  token: z.string().uuid('Неверный формат токена'),
  newPassword: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
});

// B4: userId убран из тела запроса — теперь читается из preauth cookie
export const twoFASendSchema = z.object({});

export const twoFAVerifySchema = z.object({
  code: z.string().length(6, 'Код должен состоять из 6 цифр'),
});

// ----------------------
// BROADCAST SCHEMA (доведение информации)
// ----------------------

const ALLOWED_BROADCAST_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.txt'];
const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB (лимит Yandex SMTP)

const broadcastAttachmentSchema = z.object({
  filename: z.string().min(1, 'Имя файла не может быть пустым'),
  content: z.string().min(1, 'Содержимое файла пустое'),
  encoding: z.string().optional(),
}).refine(
  (att) => {
    const ext = '.' + (att.filename.split('.').pop()?.toLowerCase() || '');
    return ALLOWED_BROADCAST_EXTENSIONS.includes(ext);
  },
  { message: `Недопустимый тип файла. Разрешены: ${ALLOWED_BROADCAST_EXTENSIONS.join(', ')}` }
);

export const broadcastSchema = z.object({
  recipientIds: z.array(z.number().int().positive()).min(1, 'Выберите хотя бы одного получателя'),
  subject: z.string().min(1, 'Тема обязательна').max(255, 'Тема не может быть длиннее 255 символов'),
  message: z.string().min(1, 'Текст сообщения обязателен').max(50000, 'Сообщение не может быть длиннее 50 000 символов'),
  attachments: z.array(broadcastAttachmentSchema).optional(),
}).superRefine((data, ctx) => {
  if (data.attachments && data.attachments.length > 0) {
    const totalSize = data.attachments.reduce((sum, att) => {
      return sum + Math.ceil(att.content.length * 3 / 4);
    }, 0);
    if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: `Общий размер вложений превышает 25 MB`,
      });
    }
  }
});

// ----------------------
// PROJECT SCHEMAS
// ----------------------

// B15: Валидация dynamicData — Record<string, unknown> с лимитом полей и длины строк
const MAX_DYNAMIC_FIELDS = 50;
const MAX_DYNAMIC_STRING_LENGTH = 500;

const baseProjectSchema = z.object({
  formType: z.string().min(1, 'Не выбран тип формы'),
  customerName: z.string().min(1, 'Укажите наименование заказчика'),
  customerInn: z.string().regex(/^\d{9}$/, 'УНП должен содержать ровно 9 цифр'),
  purchaseMethod: z.string().optional(),
  executionDate: z.string().optional().or(z.date()).or(z.null()),
}).passthrough();

export const createProjectSchema = baseProjectSchema.superRefine((data, ctx) => {
  const knownKeys = ['formType', 'customerName', 'customerInn', 'purchaseMethod', 'executionDate'];
  const dynamicKeys = Object.keys(data).filter(k => !knownKeys.includes(k));
  if (dynamicKeys.length > MAX_DYNAMIC_FIELDS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dynamicData'],
      message: `Слишком много полей в dynamicData (максимум ${MAX_DYNAMIC_FIELDS})`,
    });
  }
  for (const key of dynamicKeys) {
    const value = data[key];
    if (typeof value === 'string' && value.length > MAX_DYNAMIC_STRING_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `Значение поля "${key}" не может быть длиннее ${MAX_DYNAMIC_STRING_LENGTH} символов`,
      });
    }
  }
});

export const updateProjectSchema = baseProjectSchema.partial();

export const updateProjectStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'REVISION', 'CLOSED']),
});

// ----------------------
// EQUIPMENT SCHEMAS
// ----------------------

const equipmentStatus = z.enum(['in_stock', 'issued', 'sold', 'repair', 'decommissioned']);

export const createEquipmentSchema = z.object({
  category: z.string().min(1, 'Категория обязательна'),
  name: z.string().min(1, 'Наименование обязательно'),
  accountingType: z.string().optional(),
  purpose: z.string().optional(),
  serialNumber: z.string().optional(),
  macAddress: z.string().optional(),
  issueDate: z.string().optional(),
  issuedTo: z.string().optional(),
  issuedToWhere: z.string().optional(),
  status: equipmentStatus.optional().default('in_stock'),
  comments: z.string().optional(),
});

export const updateEquipmentSchema = createEquipmentSchema.partial();

// ----------------------
// CHAT SCHEMAS
// ----------------------

export const sendMessageSchema = z.object({
  text: z.string().min(1, 'Сообщение не может быть пустым').max(3000, 'Максимум 3000 символов'),
});

// ----------------------
// 1C INTEGRATION SCHEMAS
// ----------------------

export const partnerQuerySchema = z.object({
  unp: z.string().regex(/^\d{9}$/, 'УНП должен содержать ровно 9 цифр'),
});