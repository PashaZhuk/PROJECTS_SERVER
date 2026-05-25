# B2B Portal API

Базовый URL: `http://<host>:5001/api`

Формат ответов:
- **Успех**: `{ success: true, data?: ..., message?: string }`
- **Ошибка**: `{ success: false, error: string, code?: string, ... }`

Авторизация: JWT access token в httpOnly cookie `jwt` или Bearer-заголовок.

---

## Аутентификация (`/api/auth`)

### POST /api/auth/register
Создание пользователя (только ADMIN).
- **Body**: `{ email, password, role, companyName?, unp?, phone?, name? }`
- **Ответ 201**: `{ success: true, data: { user } }`

### POST /api/auth/login
Вход в систему.
- **Body**: `{ email, password }`
- **Ответ 200**: `{ success: true, data: { user, token } }`
- **2FA для USER**: `{ success: true, status: '2FA_REQUIRED', data: { userId, requires2FA: true } }`
- **Ошибки**: блокировка пароля, 2FA, неверные данные

### POST /api/auth/2fa/send
Отправить 6-значный код по SMS. Rate limit: 3/мин.
- **Body**: `{ userId }`

### POST /api/auth/2fa/verify
Проверить код 2FA. 3 попытки → блокировка 15 мин.
- **Body**: `{ userId, code }`
- **Ответ 200**: access + refresh токены в cookies, user в теле

### POST /api/auth/refresh
Ротация refresh токена (читает из cookie `refreshToken`).
- **Cookie входа**: `refreshToken` (httpOnly, path=/api/auth)

### POST /api/auth/logout
Выход. Отзывает refresh токены.
- **Body**: `{ reason?, userId? }`

### GET /api/auth/profile
Профиль текущего пользователя.
- **Middleware**: `auth`

### POST /api/auth/forgot-password
Запрос сброса пароля (письмо на email).
- **Body**: `{ email }`

### POST /api/auth/reset-password
Сброс пароля по токену из письма.
- **Body**: `{ token, newPassword }`

---

## Пользователи (`/api/user`)

### GET /api/user/users
Список пользователей (админ). Пагинация + поиск.
- **Middleware**: `auth`, `admin`
- **Query**: `page`, `search`

### DELETE /api/user/users/:id
Удалить пользователя.
- **Middleware**: `auth`, `admin`

### PATCH /api/user/users/:id/block
Заблокировать/разблокировать пользователя.
- **Middleware**: `auth`, `admin`

### POST /api/user/change-password
Смена пароля (первый вход).
- **Middleware**: `auth`
- **Body**: `{ currentPassword, newPassword }`

### GET /api/user/admin/stats
Статистика для админа (всего пользователей, онлайн).
- **Middleware**: `auth`, `admin`
- **Ответ**: `{ totalUsers, totalManagers, onlineCount, details: { onlineUsers, onlineManagers, onlineUserNames, onlineManagerNames } }`

---

## Проекты (`/api/projects`)

### GET /api/projects
Список проектов. USER видит свои, MANAGER/ADMIN — все.
- **Middleware**: `auth`
- **Query**: `page`, `search`

### POST /api/projects
Создать проект.
- **Middleware**: `auth`
- **Body**: зависит от формы

### PUT /api/projects/:id
Обновить проект.
- **Middleware**: `auth`

### PATCH /api/projects/:id/status
Изменить статус проекта (MANAGER).
- **Middleware**: `auth`, `manager`
- **Body**: `{ status }`

---

## Админ (`/api/admin`)

Все эндпоинты require `auth` + `admin`.

### GET /api/admin/logs
Логи сервера. Query: `level`, `search`, `limit`, `date`.

### GET /api/admin/settings
Все настройки.

### GET /api/admin/settings/:key
Конкретная настройка.

### PUT /api/admin/settings/:key
Обновить настройку.

### DB Browser

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /api/admin/db/tables | Список таблиц (whitelist) |
| GET | /api/admin/db/tables/:tableName | Данные таблицы с пагинацией |
| PUT | /api/admin/db/tables/:tableName/:id | Редактировать строку |

ReadOnly поля: password, resetPassword*, currentSessionId, createdAt, updatedAt, lastSeen.

### Backup

| Метод | Путь | Описание |
|-------|------|----------|
| POST | /api/admin/backup/create | Создать бэкап (pg_dump via docker exec) |
| POST | /api/admin/backup/upload | Загрузить .sql файл |
| GET | /api/admin/backup/list | Список бэкапов |
| GET | /api/admin/backup/download/:filename | Скачать бэкап |
| DELETE | /api/admin/backup/:filename | Удалить бэкап |
| POST | /api/admin/backup/restore/:filename | Восстановить из бэкапа (psql via docker exec) |
| GET | /api/admin/backup/schedule | Получить расписание бэкапов |
| PUT | /api/admin/backup/schedule | Установить расписание бэкапов (cron-выражение) |

---

## Менеджер (`/api/manager`)

Все эндпоинты require `auth` + `manager`.

### GET /api/manager/partners
Список партнёров.

### POST /api/manager/send-broadcast
Отправить рассылку (email). Лимит body: 50mb.
- **Body**: `{ subject, message, filters?, attachments? }`

### Оборудование

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /api/manager/equipment | Список оборудования (пагинация, категория) |
| GET | /api/manager/equipment/categories | Список категорий |
| GET | /api/manager/equipment/:id | Детали оборудования |
| POST | /api/manager/equipment | Добавить оборудование |
| PUT | /api/manager/equipment/:id | Изменить оборудование |
| DELETE | /api/manager/equipment/:id | Удалить оборудование |

### Новости (менеджер)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /api/manager/news | Список новостей |
| POST | /api/manager/news | Создать новость |
| DELETE | /api/manager/news/:id | Удалить новость |

### Логи

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /api/manager/broadcast-log | Журнал рассылок |
| GET | /api/manager/events | История событий (EventLog) |

---

## Новости (публичные, `/api/news`)

### GET /api/news
Список новостей для USER. Без авторизации.

---

## Настройки (публичные, `/api/settings`)

### GET /api/settings/:key
Получить публичную настройку. Без авторизации.

---

## Компании (`/api/companies`)

### GET /api/companies
Список компаний (для формы регистрации).
- **Middleware**: `auth`, `admin`

---

## Чат (`/api/chat`)

### GET /api/chat/:projectId/messages
История сообщений проекта.
- **Middleware**: `auth`

### POST /api/chat/:projectId/messages
Отправить сообщение.
- **Middleware**: `auth`
- **Body**: `{ text, fileUrl? }`

### PATCH /api/chat/:projectId/read
Отметить сообщения как прочитанные.
- **Middleware**: `auth`

---

## Socket.IO события

### Клиент → Сервер

| Событие | Данные | Описание |
|---------|--------|----------|
| `identify_user` | `{ userId, userRole }` | Идентификация при подключении |
| `subscribe_admin_stats` | — | Подписаться на статистику |
| `join_project` | `{ projectId }` | Подключиться к чату проекта |
| `join_self_room` | `userId` | Личная комната |
| `user_logging_out` | — | Уведомить о выходе |

### Сервер → Клиент

| Событие | Данные | Описание |
|---------|--------|----------|
| `stats_updated` | `AdminStats` | Обновление статистики (admin_room) |
| `user:online` | `userId` | Пользователь онлайн |
| `user:offline` | `userId` | Пользователь офлайн |
| `user:registered` | — | Новый пользователь |
| `user:blocked_status_changed` | `{ userId, ... }` | Изменение блокировки |
| `session_superseded` | — | Сессия завершена (другой вход) |
| `user_status_changed` | `{ userId, lastSeen }` | Статус изменён |

### Комнаты

| Комната | Участники | Описание |
|---------|-----------|----------|
| `admin_room` | ADMIN, MANAGER | Статистика, события онлайн |
| `user_{id}` | USER | Личные события (superseded) |
| `project_{id}` | Все участники | Чат проекта |
