# Code Review бэкенда (B2B server) — 2026-08-03

> Дата ревью: 2026-08-03. Основание: изучение исходников (`src/`, `routes/`, `services/`) + `npx tsc --noEmit` + `npx vitest run`.

## Сводка текущего состояния

| Проверка | Результат |
|----------|-----------|
| `npx tsc --noEmit` | ✅ **0 ошибок** |
| `npm test` (vitest) | ⚠️ **2 из 108 падают** (106 ✅) — хрупкие тесты на `DISABLE_2FA` |
| Сборка/старт | ⚠️ Нет `build`/`start` скриптов в `package.json` (только `dev`/`test`) |

**Что хорошо:** чёткое разделение слоёв, refresh-токены с SHA-256 хешем и ротацией + детект reuse, lock-механизм от брутфорса (password/2FA), zod-валидация, `AppError` + централизованный `errorHandler`, winston-логирование с ротацией, `asyncHandler`, защита от directory traversal в бэкапах, маскирование телефонов в логах.

**Но есть критические проблемы безопасности**, включая полную утечку 2FA-кода клиенту (подтверждает C1 из клиентского ревью — бэкенд действительно отдаёт `debugCode` **всегда**).

---

## 🔴 Критичные (Security — требуют немедленного исправления)

### B1. Утечка 2FA-кода клиенту в проде (подтверждает клиентский C1)
[`authService.ts:259`](src/services/authService.ts:259) — `send2FACodeService` **всегда** возвращает `{ debugCode: code }` из API, **даже при успешной отправке SMS**:
```ts
console.log(`🔐 2FA CODE for ${user.email}: ${code} (SMS ID: ${smsResult.messageId})`);
return { debugCode: code };   // ← всегда!
```
Фронт оборачивает это в `import.meta.env.DEV`, но сам факт передачи кода в ответе API — уязвимость: любой перехватчик запроса (логгер, прокси, devtools) видит код. Код также **всегда пишется в консоль сервера** через `console.log` (не `logger`), а в `send2FACode` контроллер отдаёт его как `data.debugCode`.
- **Действие:** возвращать `debugCode` только при `NODE_ENV !== 'production'` (и/или `SMART_SENDER` не настроен). Логировать код в консоль только в dev. Ответ сервера в проде: `{ success: true, message }` без кода.

### B2. Нет проверки доступа в `sendMessage`
[`chatService.ts:21`](src/services/chatService.ts:21) — `sendMessage(projectId, text, senderId)` **не проверяет**, принадлежит ли проект отправителю (в отличие от `getProjectMessages`, где проверка есть). Любой авторизованный пользователь может писать в **чужой** проект, перебирая `projectId`.
- **Действие:** добавить проверку как в `getProjectMessages`: `if (userRole !== 'MANAGER' && project.partnerId !== senderId) throw AppError(403)`.

### B3. Нет проверки доступа в `markMessagesAsRead`
[`chatService.ts:36`](src/services/chatService.ts:36) — `markMessagesAsRead(projectId, userId)` не проверяет доступ к проекту. Любой пользователь может пометить прочитанными чужие сообщения.
- **Действие:** добавить ту же проверку доступности проекта.

### B4. IDOR в 2FA: `userId` приходит от клиента
[`authController.ts:36`](src/controllers/authController.ts:36) и `:42` — `send2FACode`/`verify2FACode` принимают `userId` из тела запроса без сверки. Зная чужой `userId`, можно инициировать отправку кода и (теоретически) пройти 2FA чужого аккаунта. Сейчас фронт «удобно» получает `userId` при `requires2FA`, но для безопасности код подтверждения должен привязываться к сессии/устройству, а не к переданному id.
- **Действие:** минимум — отдавать `userId` в httpOnly-куку/подписанный токен при шаге «требуется 2FA»; сверять его на `verify`. Либо ввести короткоживущий pre-auth токен.

---

## 🟠 Высокий приоритет

### B5. `updateProject` запрещает ADMIN (баг прав)
[`projectService.ts:88`](src/services/projectService.ts:88) — `if (project.partnerId !== userId && userRole !== 'MANAGER') throw 403`. Админ не проходит (`userRole === 'ADMIN'` ≠ `'MANAGER'`) и не может редактировать проект, хотя должен.
- **Действие:** `userRole !== 'MANAGER' && userRole !== 'ADMIN'`.

### B6. Некриптостойкий 2FA-код
[`authService.ts:219`](src/services/authService.ts:219) — `Math.floor(100000 + Math.random() * 900000)`. `Math.random()` не является CSPRNG; для 6-значного кода перебор 10⁶ — реальная атака, а слабый PRNG упрощает предсказание. Также bcrypt cost = 6 (низкий).
- **Действие:** `crypto.randomInt(100000, 1000000)` и cost 10.

### B7. Нет rate-limit на `/api/auth/login`, `/forgot-password`, `/logout`
[`authRoutes.ts:16`](src/routes/authRoutes.ts:16) — только общий лимитер `500/15мин` на `/api/`. Атаки на логин и спам письмами не ограничены должным образом (app-level lock срабатывает на 5-й попытке, но это после 4 запросов к БД — DoS-вектор).
- **Действие:** отдельный rate limiter на `login` (например 10/мин с IP) и на `forgot-password` (3/час с IP).

### B8. Слабые/хардкод-секреты и адреса в коде
- [`integrationOneCService.ts:4`](src/services/integrationOneCService.ts:4) — `ONEC_BASE_URL` с внутренним IP `192.168.85.85`, `ONEC_USER ?? 'B2BAPI'` — credentials/инфраструктура в исходниках.
- [`backupService.ts:12`](src/services/backupService.ts:12) — `CONTAINER_NAME = 'projects_postgres_18'`, `DB_NAME`, `DB_USER = 'admin'`.
- **Действие:** вынести в `.env`, убрать дефолты с реальными значениями.

### B9. `JWT_SECRET as string` без проверки
[`authMiddleware.ts:33`](src/middleware/authMiddleware.ts:33) и [`server.ts:159`](src/server.ts:159) — `jwt.verify(token, process.env.JWT_SECRET as string)`. Если секрет не задан в проде — jwt.verify бросит ошибку, но сообщение будет невнятным; лучше валидировать при старте (в `generateAccessToken` проверка есть, в middleware — нет).
- **Действие:** добавить проверку наличия `JWT_SECRET` на старте сервера (fail fast).

### B10. `express.urlencoded` лимит 10kb, а broadcast-вложения — 50mb
[`server.ts:100`](src/server.ts:100) — глобальный `urlencoded({ limit: '10kb' })`, но `managerRoutes` использует `express.json({ limit: '50mb' })` для рассылки. Несоответствие может вести к неожиданным 413 для запросов, идущих через другие content-types. Мелочь, но стоит унифицировать.

---

## 🟡 Средний приоритет / архитектура

### B11. Дублирование `validate` middleware
`middleware/validate.ts` и `utils/validationSchemas.ts` (функция `validate`) — два одинаковых middleware. Причём версия в `validationSchemas.ts` **не присваивает** `req.body = parsed`, из-за чего zod-дефолты (например `equipmentStatus.default('in_stock')`) не применяются.
- **Действие:** оставить один `validate.ts`, использовать `schema.parse()` и присваивать `req.body`.

### B12. Дублирование парсинга cookie в socket-auth
[`server.ts:148-237`](src/server.ts:148) — ручной разбор `cookieHeader` повторяется дважды (для access и для refresh-ветки). Нет `cookie-parser` для socket-хендшейка.
- **Действие:** вынести в функцию `parseCookies(header)` или использовать `cookie`/`cookie-parser` на handshake.

### B13. Socket refresh-ротация без детекта reuse
[`server.ts:199`](src/server.ts:199) — при истёкшем access-токене socket вручную ротирует refresh-токен, но **не проверяет** `revokedAt` (в отличие от `rotateRefreshToken` в `generateToken.ts`). Если refresh-токен украден и использован в socket — нет детекта компрометации.
- **Действие:** переиспользовать `rotateRefreshToken` или добавить проверку reuse.

### B14. Не ограничены `limit` в `getProjects` и `getUsersList`
[`projectService.ts:42`](src/services/projectService.ts:42) и [`userService.ts:15`](src/services/userService.ts:15) — `limit` берётся из query без верхней границы (`limit=1000000` → полная выгрузка БД).
- **Действие:** `Math.min(limit, 100)`.

### B15. `dynamicData` без валидации
[`projectService.ts:8,89`](src/services/projectService.ts:8) — `createProjectSchema.passthrough()` позволяет любые поля; `otherData` сохраняется как `dynamicData` без ограничения размера/структуры. `express.json({ limit: '2mb' })` ограничивает общий размер, но структура не контролируется.
- **Действие:** как минимум валидировать `dynamicData` как `Record<string, unknown>` с ограничением числа/размера полей.

### B16. HTML-инъекция в `sendBroadcast`
[`managerController.ts:51`](src/controllers/managerController.ts:51) — `html: message` — текст рассылки вставляется как HTML без экранирования. Письма не выполняют JS, но фишинговые ссылки/HTML-разметка пройдут как есть.
- **Действие:** экранировать или явно документировать, что `message` — HTML.

### B17. `search` с wildcard (ILIKE)
[`projectService.ts:48`](src/services/projectService.ts:48), [`userService.ts:21`](src/services/userService.ts:21) — `contains: search` — пользователь может передать `%`/`_`, что превращается в wildcard-поиск (неточные результаты, лёгкая нагрузка). Низкий риск, но стоит экранировать.

### B18. `emailService` — отправка письма вне транзакции с create
[`authService.ts:92`](src/services/authService.ts:92) — `prisma.user.create` затем `sendWelcomeEmailToUser` (который кидает при сбое SMTP). При сбое SMTP юзер уже создан, а клиент получит 500.
- **Действие:** `try/catch` вокруг отправки письма (не ронять регистрацию), либо очередь.

### B19. Нет `beforeExit`/graceful shutdown
`server.ts` — есть `unhandledRejection`, но нет перехвата SIGTERM/SIGINT и вызова `disconnectDB()`/закрытия http-сервера.

---

## 🟢 Качество кода / типизация

### B20. Массовый `any`
- Контроллеры: `req: any` (`authController`, `chatController`, `projectController`, `userController`, `adminController`).
- Middleware: `req: any` (`adminMiddleware`, `managerMiddleware`), `AuthRequest.user?: any` (`authMiddleware`).
- Сервисы: `data: any`, `query: any`, `logMeta?: any`, `user: any` (`authService`, `projectService`, `userService`, `statsService`, `chatService`).
- `statsService.globalIo: any`, socket handlers — `any`, `sockets.forEach((s: any)`.
- `generateToken.rotateRefreshToken` → `user?: any`.
- `dbService` — `$queryRawUnsafe`, но типы колонок частично описаны. `getTableData` возвращает `Record<string, unknown>[]` — ок.
- **Действие (поэтапно):** ввести `src/types/` (User, Project, ProjectStatus, ChatMessage, AuthPayload, SocketPayload), заменить `req: any` на `AuthRequest` с дженериком, `logMeta` — типизированный интерфейс.

### B21. `AuthRequest` дублируется
`authMiddleware` определяет `interface AuthRequest { user?: any }` локально; `adminMiddleware`/`managerMiddleware` используют `req: any`. Нужен общий тип в `src/types/express.d.ts`.

### B22. `console.*` вместо `logger` (непозволительно в проде)
- `server.ts:31-50,246,263,267,277,282,290` — `console.log/error`.
- `authService.ts:237,248,258` — `console.log` 2FA-кода (см. B1).
- `emailService.ts:20-27,55,58` — `console.warn/log/error`.
- `statsService.ts:7,67,83,86` — `console.log/error/warn`.
- `generateToken.ts:124` — `console.warn`.
- `authMiddleware.ts:86,103` — `console.error`.
- `managerMiddleware.ts:6` — `console.log` (debug-мусор в проде).
- **Действие:** заменить на `logger.*` (в проде они и так пишутся в файлы).

### B23. Нет билд-скриптов
`package.json` — только `dev`, `test`, `test:watch`. Нет `build` (tsc), нет `start` (prod). Для деплоя непонятно, как собирается/запускается прод.
- **Действие:** добавить `build: tsc -p tsconfig.json`, `start: node dist/src/server.js` (после настройки outDir).

### B24. `package.json` — имя `hello-prisma`
Осталось от стартового шаблона. Косметика, но стоит переименовать в `b2b-server`.

### B25. `tsconfig.json` — `moduleResolution: "node"` при `module: ESNext`
Для ESM лучше `"moduleResolution": "node16"|"nodenext"` или `"bundler"`. Также `declaration: true` + `jsx: react-jsx` — для сервера jsx не нужен (копипаста с клиента).

### B26. `emailService` инициализирует transporter на import
`nodemailer.createTransport` с `SMTP_*` — при отсутствии env-переменных процесс упадёт на старте. Лучше ленивая инициализация/проверка.

### B27. Тесты: 2 хрупких из 108
[`tests/services/authService.test.ts:95,149`](tests/services/authService.test.ts:95) — тесты зависят от `process.env.DISABLE_2FA`, который не контролируется (в ветке `if (process.env.DISABLE_2FA === 'true')` ожидают `success:true`, но сервис вернул `requires2FA`). Вероятна гонка параллельных файлов тестов, меняющих env.
- **Действие:** в тестах явно выставлять `process.env.DISABLE_2FA` в `beforeEach`/`beforeAll` (или мокать через `vi.stubEnv`).

### B28. Нет тестов на критические сервисы
Покрыты: `authService`, `userService`, `generateToken`, `smsService`, `companyService`, `validationSchemas`, `response`. **Нет** тестов на:
- `chatService` (проверка доступа!) — B2/B3;
- `projectService` (права ADMIN — B5, дубликаты УНП, пагинация);
- `backupService` (валидация filenames, schedule);
- `statsService` (online-статусы);
- `managerController.sendBroadcast`;
- `middleware` (authMiddleware — блокировка/сессия/неактивность).

### B29. Служебные файлы в корне репо
`export_for_ai.py`, `.project-summary.md`, `restore.sh`, `demo-plan.md`, `data-flow-scenarios.md` — часть утилитарная/документация. Проверить `.gitignore`.

---

## 📅 План работ (по приоритету)

### Этап 1 — «Безопасность» (критично, блокирует прод)
1. **B1** — убрать `debugCode` из ответа API в проде; `console.log` 2FA → `logger` + только dev.
2. **B2/B3** — добавить проверку доступа в `sendMessage` и `markMessagesAsRead`.
3. **B4** — привязать 2FA-флоу к сессии/токену вместо доверия `userId` из тела.
4. **B5** — разрешить ADMIN в `updateProject`.
5. **B6** — `crypto.randomInt` для 2FA-кода.
6. **B9** — fail-fast проверка `JWT_SECRET` на старте.
7. **B13** — reuse-детект в socket refresh-ротации.

### Этап 2 — «Rate limit и защита от злоупотреблений»
8. **B7** — rate-limit на `login`, `forgot-password`.
9. **B14** — ограничить `limit` в пагинации проектов/пользователей.
10. **B15** — валидация `dynamicData`.
11. **B17** — экранирование wildcard в поиске.

### Этап 3 — «Архитектура»
12. **B11** — единый `validate` middleware, применять zod-дефолты.
13. **B12** — вынести парсинг cookie для socket.
14. **B16** — экранировать HTML в broadcast.
15. **B18** — не ронять регистрацию при сбое email.
16. **B19** — graceful shutdown.

### Этап 4 — «Типизация»
17. **B20/B21** — `src/types/`, общий `AuthRequest`, убрать `any` (начать с контроллеров и middleware).
18. **B22** — заменить `console.*` на `logger.*` (server, authService, emailService, statsService и т.д.).

### Этап 5 — «Конфигурация и качество»
19. **B23/B24/B25** — скрипты build/start, имя пакета, tsconfig для сервера (без jsx, ESM resolution).
20. **B8** — секреты в `.env` (1C, Docker, БД).
21. **B26** — ленивая инициализация SMTP.
22. **B29** — `.gitignore` для служебных файлов.

### Этап 6 — «Тесты»
23. **B27** — починить хрупкие тесты (`vi.stubEnv`).
24. **B28** — тесты на `chatService` (доступ), `projectService` (права), `authMiddleware`, `backupService`.

---

## 🔗 Связь с клиентским ревью (2026-08-03)

| Клиентский пункт | Подтверждение на сервере |
|------------------|--------------------------|
| C1 — `debugCode` 2FA приходит с бэкенда | ✅ **B1** — бэкенд отдаёт код всегда, и в проде |
| C2 — нестабильный конверт ответа | ✅ Контроллеры используют `sendSuccess`/`sendError` (`{ success, data/error }`), но местами вручную `res.status(200).json({ success: true, status: '2FA_REQUIRED', ... })` — нестандартное поле `status` вместо `data` ([`authController.ts:29`](src/controllers/authController.ts:29)) |
| S1 — health-check для AdminDashboard | ❌ Нет health-check эндпоинта на сервере — нужно добавить `GET /api/health` |

---

## ✅ Что сделано хорошо (сохранить)

- Refresh-токены: SHA-256 хеш + ротация + детект reuse с отзывом всех сессий ([`generateToken.ts`](src/utils/generateToken.ts)).
- Lock-механика брутфорса: `failedLoginAttempts` → 5 → `lockUntil`; `twoFactorAttempts` → 3 → `twoFactorLockUntil`.
- `AppError` + `errorHandler` (единый формат ошибок, zod-детали в dev, логирование с метаданными).
- `asyncHandler` — нет утечек rejected promises в контроллерах.
- Экранирование/маскирование телефонов в логах (`phone.replace(/\d{4}$/, '****')`).
- Бэкапы: `exec` с таймаутом, валидация filename от traversal, ограничение размера файлов (500 MB), cron-валидация.
- Интеграция с 1С: таймауты (`AbortSignal.timeout`), парсинг и нормализация ответов.
- Ротация логов через `winston-daily-rotate-file`.

---

## Итоговая оценка

Бэкенд **структурно здоров, но не готов к проду** из-за критичных уязвимостей:
1. **Утечка 2FA-кода** (B1) — напрямую подтверждена в коде.
2. **Отсутствие проверки доступа к чату** (B2/B3) — IDOR-уязвимость.
3. **Доверие клиентскому `userId` в 2FA** (B4).
4. **Баг прав: ADMIN не может редактировать проект** (B5).
5. **Некриптостойкий генератор 2FA-кода** (B6).

Этап 1 (безопасность) — обязательный минимум перед любым деплоем. Этапы 3–4 — типизация и архитектура (1–2 дня). Этап 6 — тесты на критические пути (доступ к чату, права, health).

Рекомендуется после исправления этапа 1 перезапустить клиентские и серверные тесты совместно (контракты: `send2FACode` без `debugCode` в проде; `AuthResponse` — единый `{ success, data }`).