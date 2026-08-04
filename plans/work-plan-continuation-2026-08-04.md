# План продолжения работ: B2B server (2026-08-04)

> Основание: ревизия `work-plan-2026-08-03.md` + фактическое состояние кода.
> Текущее состояние: `npx tsc --noEmit` — ✅ 0 ошибок; `npm test` — ⚠️ 120/121 (1 failed — устаревший тест `twoFASendSchema`).

---

## Этап 1 — «Добить безопасность» (критично)

### 1.1 🔴 B7 — Rate limit на `login` и `forgot-password`
**Файл:** `src/routes/authRoutes.ts`
**Проблема:** лимитеры есть только на `refresh` (10/мин) и `2fa/send` (3/мин). `login` и `forgot-password` не ограничены (только общий 500/15мин).
**Действия:**
- `loginLimiter = rateLimit({ windowMs: 60_000, max: 10 })` — навесить на `router.post('/login', ...)`;
- `forgotPasswordLimiter = rateLimit({ windowMs: 3_600_000, max: 3 })` — навесить на `router.post('/forgot-password', ...)`.
**Чек:** curl 11-й login подряд → 429; 4-й forgot-password → 429.

### 1.2 🟠 B10 — Унифицировать лимиты body-parser
**Файлы:** `src/server.ts` (urlencoded 10kb), `src/routes/managerRoutes.ts` (json 50mb)
**Проблема:** несогласованность лимитов может давать неожиданные 413.
**Действие:** вынести лимиты в константы/конфиг, согласовать (например, глобальный `json({ limit: '50mb' })` или явно задокументировать).

---

## Этап 2 — «Типизация» (B20/B21 — завершить)

### 2.1 🟢 Убрать `req: any` в контроллерах
**Файлы:** `src/controllers/projectController.ts`, `src/controllers/settingsController.ts`
**Действие:** заменить `req: any` → `AuthRequest` (тип уже есть в `src/types/express.ts`).

### 2.2 🟢 Убрать `req: any` в middleware
**Файлы:** `src/middleware/adminMiddleware.ts`, `src/middleware/managerMiddleware.ts`, `src/middleware/authMiddleware.ts`
**Действие:** `req: AuthRequest`; `AuthRequest.user?: any` → типизированный `User`.

### 2.3 🟢 Типизировать сервисы
**Файлы:** `src/services/authService.ts`, `src/services/adminService.ts`, `src/services/projectService.ts`, `src/services/userService.ts`, `src/services/statsService.ts`, `src/services/chatService.ts`
**Действия:**
- `logMeta?: any` → `LogMeta` (интерфейс из `src/types/`);
- `data: any`, `query: any` → zod-infer типы;
- `user: any` → `User` из Prisma;
- `statsService.globalIo: any` → `Server` из socket.io.
**Чек:** `grep -rn ": any" src/controllers src/middleware` → пусто; `npx tsc --noEmit` ✅.

---

## Этап 3 — «Тесты» (B28 — завершить + починить 1 failed)

### 3.1 🟢 Починить устаревший тест
**Файл:** `tests/utils/validationSchemas.test.ts:86`
**Проблема:** тест `twoFASendSchema > отклоняет userId не число` ожидает `{ userId: 'abc' }` → `success: false`, но после B4 схема `z.object({})` принимает любые поля.
**Действие:** обновить тест под новый контракт (userId убран из тела) — например, проверить, что `twoFASendSchema` парсит пустой объект и игнорирует лишние поля.

### 3.2 🟢 Новые тесты
**Новые файлы:**
- `tests/services/backupService.test.ts` — валидация filename (traversal), cron-выражения;
- `tests/services/statsService.test.ts` — online-статусы;
- `tests/controllers/managerController.test.ts` — `sendBroadcast` (валидация, экранирование HTML).
**Чек:** `npm test` — все зелёные (121 + новые).

---

## Этап 4 — «Синхронизация с клиентом»

### 4.1 🟠 Health-check на клиенте (S1)
**Файл:** `client/src/pages/AdminDashboard.tsx:33`
**Проблема:** `const isSystemOnline = true` — мок, не подключено к `/api/health`.
**Действие:** подключить `isSystemOnline` к `GET /api/health` (эндпоинт на сервере уже есть).

### 4.2 🟢 Убрать `console.log` 2FA-кода на клиенте
**Файл:** `client/src/pages/LoginPage.tsx:184`
**Действие:** удалить `console.log('🔐 2FA CODE:', res.debugCode)` полностью (сейчас обёрнуто в `import.meta.env.DEV`).

---

## Этап 5 — «Чистка репозитория»

### 5.1 🟢 B29 — Служебные файлы
**Файлы:** untracked `scripts/check_admin.ts`, `check_phone.ts`, `check_raw_phone.ts`, `fix_final.ts`, `fix_phone_admin.ts`, `fix_phones.ts`, `force_phone.ts`, `verify_phone.ts`
**Действие:** перенести в `scripts/` (уже там) и добавить в `.gitignore` или удалить, если разовые.

### 5.2 🟢 Коммит незакоммиченных изменений
**Статус:** 29 modified + новые файлы (`src/types/`, `src/utils/cookies.ts`, `tests/services/chatService.test.ts`, `.env.example`) — в working tree.
**Действие:** закоммитить после завершения этапов 1–4.

---

## ⚡ Порядок выполнения и чек-лист готовности

| Шаг | Пункт | Чек после выполнения |
|-----|-------|----------------------|
| 1 | 1.1 B7 | curl 11-й login → 429; 4-й forgot-password → 429 |
| 2 | 1.2 B10 | запрос с большим body → согласованный ответ |
| 3 | 2.1–2.3 B20/B21 | `grep -rn ": any" src/controllers src/middleware` → пусто; `tsc --noEmit` ✅ |
| 4 | 3.1 тест twoFASendSchema | `npm test` — 121/121 ✅ |
| 5 | 3.2 новые тесты | `npm test` — 121 + новые зелёные |
| 6 | 4.1 health на клиенте | AdminDashboard показывает реальный статус |
| 7 | 4.2 убрать console.log | `grep -rn "2FA CODE" client/src` → пусто |
| 8 | 5.1–5.2 чистка | `git status` чистый; коммит создан |

## 🔗 Требует синхронизации
- **Health (4.1):** клиентский `AdminDashboard.tsx` — подключить к `/api/health`.
- **debugCode (4.2):** клиентский `LoginPage.tsx` — удалить `console.log`.
- **Прогон контрактов:** после этапа 1 — совместный запуск серверных и клиентских тестов.