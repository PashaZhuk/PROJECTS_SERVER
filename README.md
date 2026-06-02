# IPMATIKA Bel B2B Portal

B2B-портал для партнёров IPMATIKA. Управление проектами, заказами, оборудованием, новостями и рассылками. Админ-панель с мониторингом, управлением пользователями, Table Browser и бэкапами БД.

## Стек

| Компонент | Технология |
|-----------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| State | Zustand, TanStack Query v5 |
| HTTP | ky |
| Backend | Express 5, TypeScript |
| ORM | Prisma 7 |
| DB | PostgreSQL 18 (Docker) |
| Auth | JWT (access 15m) + refresh token rotation (7d), httpOnly cookies |
| 2FA | SMS через Smart Sender A1 (6-значный код, bcrypt, 5 мин expiry) |
| Rate limit | express-rate-limit |
| WebSocket | Socket.IO (чат, статусы онлайн, статистика) |
| Тесты | Vitest + supertest (сервер), Vitest + testing-library (клиент) |

## Структура

```
B2B/
├── client/          # React SPA (Vite, порт 5173)
│   ├── src/
│   │   ├── api/            # HTTP-клиент (ky) + socket
│   │   ├── components/     # UI компоненты
│   │   ├── hooks/          # React hooks (TanStack Query, sockets)
│   │   ├── pages/          # Страницы (Login, Dashboard)
│   │   ├── store/          # Zustand stores
│   │   └── types/          # TypeScript типы
│   └── tests/              # Клиентские тесты
│
├── server/          # Express API (порт 5001)
│   ├── src/
│   │   ├── config/         # Prisma client, env
│   │   ├── controllers/    # HTTP-контроллеры
│   │   ├── middleware/     # auth, admin, manager, errorHandler
│   │   ├── routes/         # Маршруты
│   │   ├── services/       # Бизнес-логика
│   │   └── utils/          # helpers (jwt, logger, validation)
│   ├── prisma/             # Schema + миграции
│   └── tests/              # Серверные тесты
│
├── .project-summary.md     # Статус проекта
├── 1c-integration-request.md  # ТЗ для 1С
└── claude-review.md         # Code review
```

## Быстрый старт

### 1. База данных

```bash
cd server
docker compose up -d          # PostgreSQL на порту 5432
npx prisma migrate deploy     # Накатить миграции
npx tsx prisma/seed.ts        # Залить тестовые данные
```

### 2. Сервер

```bash
cd server
cp .env.example .env          # Настроить окружение
npm install
npm run dev                   # nodemon + tsx → http://0.0.0.0:5001
```

### 3. Клиент

```bash
cd client
npm install
npm run dev                   # Vite dev → http://192.168.85.110:5173
```

### Тестовые учётные данные

| Роль | Email | Пароль |
|------|-------|--------|
| ADMIN | admin@test.com | admin |
| MANAGER | manager@test.com | manager |
| USER | — | регистрируется через админа |

## Переменные окружения (server/.env)

```env
PORT=5001
HOST=0.0.0.0
DATABASE_URL="postgresql://admin:password@127.0.0.1:5432/b2b_portal?schema=public"
JWT_SECRET="..."
JWT_EXPIRES_IN=15m

# SMTP (Yandex)
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_USER=support@ipmatika.by
SMTP_PASS=...
SMTP_SECURE=true
CLIENT_URL=http://192.168.85.110:5173

# Smart Sender A1 (SMS для 2FA)
SMART_SENDER_USER=...
SMART_SENDER_APIKEY=...
SMART_SENDER_SENDER=support_IPM
```

## Тестирование

### Сервер

```bash
cd server
docker compose -f docker-compose.test.yml up -d  # PG на порту 5433
npm test                                           # 54 теста
```

### Клиент

```bash
cd client
npm test                                           # 22 теста
```

## Ключевые архитектурные решения

- **Авторизация**: JWT access (15m) + refresh token rotation (7d). Refresh хранится как SHA-256 хеш в БД. Reuse detection — при повторном использовании отозванного токена все сессии пользователя инвалидируются.
- **2FA**: 6-значный bcrypt-хеш, 5 мин expiry, 3 попытки → 15 мин блокировка. Rate limit: 3 запроса/мин на отправку кода.
- **Формат ответов API**: единый `{ success: true, data: ... }` / `{ success: false, error: "..." }`.
- **Статистика онлайн**: через Socket.IO. StatsService собирает online/offline из сокет-соединений и эмитит `stats_updated` в admin_room.
- **1С интеграция**: запланирована. 4 эндпоинта (компании, финансы, прайс-лист, акт сверки). Подробнее: `1c-integration-request.md`.
