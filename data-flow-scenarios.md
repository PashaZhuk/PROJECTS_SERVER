# B2B Portal — Полный список Data Flow сценариев

Все сценарии описаны в формате:
**Client → Route → [Middleware] → Controller → Service → DB → [Socket] → Response**

---

## 1. Аутентификация (Auth)

### 1.1 Регистрация пользователя (Admin создаёт USER или MANAGER)
- **Route:** `POST /api/auth/register`
- **Middleware:** `authMiddleware` → `adminMiddleware` → `validate(registerSchema)`
- **Controller:** `authController.register()`
- **Service:** `authService.registerUser(data, logMeta)`
  1. Проверка уникальности email в `prisma.user.findUnique`
  2. Если роль USER: проверка `companyName`, `unp`, `phone` на уникальность
  3. Хеширование пароля `bcrypt.genSalt(10) → bcrypt.hash(password, salt)`
  4. `prisma.user.create()` в БД
  5. `sendWelcomeEmailToUser()` — отправка приветственного письма через `emailService.sendEmail()`
- **Socket:** Нет
- **Response:** `201 { user: { id, name, email, role, companyName } }`
- **Ошибки:** 400 (дубликат email/УНП/компании/телефона), 401 (не авторизован), 403 (не админ)

### 1.2 Логин пользователя (первые шаги до 2FA)
- **Route:** `POST /api/auth/login`
- **Middleware:** `validate(loginSchema)`
- **Controller:** `authController.login()`
  1. Извлекает `email`, `password` из `req.body`
  2. Вызывает `authService.loginUser(email, password, res, logMeta)`
- **Service:** `authService.loginUser()`
  1. `prisma.user.findUnique({ where: { email } })`
  2. Проверка `isBlocked` → `{ success: false, userBlocked: true }`
  3. Проверка `lockUntil` (password lock) → `{ success: false, lockType: 'password', timeLeft }`
  4. Проверка `twoFactorLockUntil` (2FA lock) → `{ success: false, lockType: '2FA', timeLeft }`
  5. `bcrypt.compare(password, user.password)` — если неверно:
     - Увеличивает `failedLoginAttempts`
     - При 5+ попытках: `lockUntil = now + 15min`, **socket emit** `emitUserLockStatus()`, возврат блокировки
     - Иначе: обновляет `failedLoginAttempts`, **socket emit** `emitUserLockStatus()`, возврат `attemptsLeft`
  6. Сброс `failedLoginAttempts` и `lockUntil` при успехе
  7. Если роль `USER` → `{ success: false, requires2FA: true, userId, email }` (2FA required)
  8. Если роль `MANAGER`/`ADMIN`:
     - Генерация `sessionId = uuidv4()`
     - `generateTokens(userId, sessionId, res)` — access JWT + refresh token в httpOnly cookies
     - **Socket:** `io.to(\`user_${id}\`).emit('session_superseded')` если уже была сессия
     - `prisma.user.update()` — `currentSessionId`, `lastSeen`
     - **Socket:** `emitStatsUpdate()`, `io.to('admin_room').emit('user:online', id)`
  9. Логирование через `logger.info/warn`
  10. Возврат `{ success: true, user, token }`
- **Controller response analysis:**
  - Если `result.userBlocked` → 403
  - Если `result.lockType === 'password'` → 429
  - Если `result.lockType === '2FA'` → 429
  - Если `result.requires2FA` → 200 `{ status: '2FA_REQUIRED', data: { userId, email } }`
  - Если `result.attemptsLeft !== undefined` → 401
  - Успех → 200 `{ user, token }`
- **Socket Events (outgoing):** `session_superseded`, `user:online`, `stats_updated` (via `emitStatsUpdate`), `user:blocked_status_changed` (via `emitUserLockStatus`)

### 1.3 Отправка 2FA кода (SMS)
- **Route:** `POST /api/auth/2fa/send`
- **Middleware:** `twoFASendLimiter` (3/min) → `validate(twoFASendSchema)`
- **Controller:** `authController.send2FACode()`
- **Service:** `authService.send2FACodeService(userId, logMeta)`
  1. `prisma.user.findUnique({ where: { id: userId } })` — проверка существования
  2. `check2FALock(user)` — если `twoFactorLockUntil > now`, throw 429
  3. Rate-limit повторного запроса: `twoFactorCodeSentAt` + 60 sec
  4. Генерация 6-значного кода, `bcrypt.hash(code, 6)`
  5. `prisma.user.update()` — сохраняет `twoFactorCodeHash`, `twoFactorCodeExpiresAt` (5 мин), `twoFactorCodeSentAt`
  6. `smsService.sendSms(phone, 'IPMATIKA: код подтверждения ${code}')` через Smart Sender A1
  7. Если нет телефона или SMS не отправлено — код выводится в console.log (debug)
  8. Логирование
  9. Возврат `{ debugCode: code }` (всегда, для консоли)
- **Response:** `200 { debugCode }`

### 1.4 Верификация 2FA кода
- **Route:** `POST /api/auth/2fa/verify`
- **Middleware:** `validate(twoFAVerifySchema)`
- **Controller:** `authController.verify2FACode()`
- **Service:** `authService.verify2FACodeService(userId, code, res, logMeta)`
  1. `prisma.user.findUnique({ where: { id: userId } })`
  2. `check2FALock(user)` — если заблокирован → `{ locked: true, timeLeft }`
  3. Проверка `twoFactorCodeHash`/`twoFactorCodeExpiresAt` — если нет кода → `{ attemptsLeft: 3 }`
  4. Проверка истечения кода → сброс хеша → `{ message: 'Код истёк' }`
  5. `bcrypt.compare(code, user.twoFactorCodeHash)` — если неверно:
     - Увеличивает `twoFactorAttempts`, при 3+ → `twoFactorLockUntil`, **socket emit** `emitUserLockStatus()`
     - Иначе возвращает `{ attemptsLeft }`
  6. Если верно:
     - Генерация `sessionId`, `generateTokens()`
     - **Socket:** `io.to(\`user_${userId}\`).emit('session_superseded')` если была сессия
     - `prisma.user.update()` — сброс 2FA попыток, блокировок, кода; установка `twoFactorVerified: true`
     - **Socket:** `emitUserLockStatus()`, `emitStatsUpdate()`, `io.to('admin_room').emit('user_status_changed')`
  7. Логирование, возврат `{ success: true, user, token }`
- **Controller response analysis:**
  - `result.locked` → 429
  - `result.attemptsLeft !== undefined` → 401
  - Успех → 200 `{ user, token }`
- **Socket Events:** `session_superseded`, `user:blocked_status_changed`, `stats_updated`, `user_status_changed`

### 1.5 Выход (Logout)
- **Route:** `POST /api/auth/logout`
- **Middleware:** нет
- **Controller:** `authController.logout()`
  1. Извлекает `userId` из `req.user?.id`
  2. Вызывает `authService.logoutUser(userId, res, logMeta)`
- **Service:** `authService.logoutUser()`
  1. `revokeUserRefreshTokens(userId)` — отзыв всех refresh токенов
  2. `prisma.user.update()` — `lastSeen = now - 10min`, `currentSessionId: null`, `twoFactorVerified: false`
  3. **Socket:** `io.to('admin_room').emit('user_status_changed', { userId, lastSeen })`, `emitStatsUpdate()`
  4. `clearRefreshCookie(res)`
- **Response:** 200 (чистит jwt cookie)

### 1.6 Забыли пароль (Forgot Password)
- **Route:** `POST /api/auth/forgot-password`
- **Middleware:** `validate(forgotPasswordSchema)`
- **Controller:** `authController.forgotPassword()`
- **Service:** `authService.forgotPasswordService(email, logMeta)`
  1. `prisma.user.findUnique({ where: { email } })` — если нет пользователя, тихо возврат
  2. Генерация `resetToken = uuidv4()`, `resetTokenExpiry = now + 1 час`
  3. `prisma.user.update()` — сохраняет токен и expiry
  4. `emailService.sendEmail()` — отправка письма с ссылкой на сброс
- **Response:** 200 `{ message: 'Если такой пользователь существует, письмо отправлено.' }`
- **Socket:** Нет

### 1.7 Сброс пароля (Reset Password)
- **Route:** `POST /api/auth/reset-password`
- **Middleware:** `validate(resetPasswordSchema)`
- **Controller:** `authController.resetPassword()`
- **Service:** `authService.resetPasswordService(token, newPassword, logMeta)`
  1. `prisma.user.findFirst({ where: { resetPasswordToken: token, resetPasswordExpires: { gte: now } } })`
  2. Если не найден → throw 400 (ссылка недействительна или истекла)
  3. `bcrypt.hash(newPassword)`, `prisma.user.update()` — новый пароль, сброс `resetPasswordToken/Expires`, `mustChangePassword: false`
- **Response:** 200 `{ message: 'Пароль успешно изменен' }`

### 1.8 Смена пароля (Change Password)
- **Route:** `POST /api/auth/change-password`
- **Middleware:** `authMiddleware`
- **Controller:** `authController.changePassword()`
  1. Извлекает `currentPassword`, `newPassword` из `req.body`
  2. `authService.changePasswordService(userId, currentPassword, newPassword, logMeta)`
- **Service:** `authService.changePasswordService()`
  1. `prisma.user.findUnique({ where: { id: userId } })`
  2. `bcrypt.compare(currentPassword, user.password)` — если не совпадает, throw 400
  3. `bcrypt.hash(newPassword)`, `prisma.user.update()` — новый пароль
- **Response:** 200 `{ message: 'Пароль успешно изменен' }`

### 1.9 Refresh токена
- **Route:** `POST /api/auth/refresh`
- **Middleware:** нет
- **Controller:** `authController.refresh()`
  1. Извлекает `rawToken` из `req.cookies?.refreshToken`
  2. `generateToken.rotateRefreshToken(rawToken, res)`
- **Service:** `generateToken.rotateRefreshToken()`
  1. Если токена нет → `{ success: false }`
  2. `hashToken(rawToken)` → SHA-256
  3. `prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } })`
  4. Если не найден → чистит cookie, `{ success: false }`
  5. Token reuse detection: `storedToken.revokedAt` — если уже отозван, отзывает ВСЕ токены пользователя
  6. Проверка `expiresAt < now` → отзыв, `{ success: false }`
  7. Ротация: новый `uuidv4()`, хеш, `prisma.$transaction([отозвать старый, создать новый])`
  8. Новый access JWT: `generateAccessToken()`, `setAccessTokenCookie()`
  9. Возврат `{ success: true, accessToken, user }`
- **Response:** 200 `{ user, token }` или 401

### 1.10 Профиль (getProfile)
- **Route:** `GET /api/auth/profile`
- **Middleware:** `authMiddleware`
- **Controller:** `authController.getProfile()`
  1. Берёт `req.user`, исключает `password`
- **Response:** 200 `{ id, email, name, role, companyName, ... }`

---

## 2. Управление пользователями (Admin)

### 2.1 Список пользователей
- **Route:** `GET /api/user/users`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `userController.getUsers()`
  1. Извлекает `page`, `limit`, `search`, `role` из `req.query`
  2. `userService.getUsersList({ page, limit, search, role })`
- **Service:** `userService.getUsersList()`
  1. Построение `where` — исключает ADMIN, фильтры по роли и поиску (name, email, companyName, unp)
  2. `prisma.user.findMany()` + `prisma.user.count()` параллельно
  3. **Socket:** `getIo().sockets.sockets` — определяет online статус по подключённым сокетам
  4. Возврат `{ users: [...with isOnline], totalCount, totalPages, currentPage }`
- **Response:** 200

### 2.2 Удаление пользователя
- **Route:** `DELETE /api/user/users/:id`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `userController.deleteUser()`
  1. `userService.deleteUserById(id, req.user.id, logMeta)`
  2. `emitStatsUpdate()`
- **Service:** `userService.deleteUserById()`
  1. Проверка `id !== currentUserId` — нельзя удалить себя
  2. `prisma.user.findUnique()` — проверка существования
  3. `prisma.user.delete()` — удаление
- **Socket Events:** `stats_updated`
- **Response:** 200 `{ message: 'Пользователь успешно удален' }`

### 2.3 Блокировка/разблокировка пользователя
- **Route:** `PATCH /api/user/users/:id/block`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `userController.toggleBlock()`
  1. `userService.toggleBlockUser(id, req.user.id, logMeta)`
- **Service:** `userService.toggleBlockUser()`
  1. Проверка `id !== currentUserId`, проверка существования, проверка что не ADMIN
  2. Если `lockUntil > now` (брутфорс блокировка) — снимает её (`lockUntil: null`, `failedLoginAttempts: 0`, `currentSessionId: null`)
  3. Если `twoFactorLockUntil > now` (2FA блокировка) — снимает её
  4. Иначе — ручная блокировка/разблокировка (`isBlocked: !user.isBlocked`, при блокировке `currentSessionId: null`)
  5. **Socket:**
     - `io.to('admin_room').emit('user:blocked_status_changed', { userId, isBlocked, wasSystemLock })`
     - Если ручная блокировка → `io.to(\`user_${targetId}\`).emit('user_blocked')`
     - Если снятие системной блокировки → `io.to(\`user_${targetId}\`).emit('user_unblocked_by_admin')`
     - `emitStatsUpdate()`
- **Socket Events:** `user:blocked_status_changed`, `user_blocked`, `user_unblocked_by_admin`, `stats_updated`
- **Response:** 200 `{ isBlocked, message }`

### 2.4 Смена пароля (сам пользователь)
- **Route:** `POST /api/user/change-password`
- **Middleware:** `authMiddleware` → `validate(changePasswordSchema)`
- **Controller:** `userController.changeDefaultPassword()`
  1. `userService.changeUserPassword(req.user.id, newPassword, logMeta)`
- **Service:** `userService.changeUserPassword()`
  1. `bcrypt.hash(newPassword)`, `prisma.user.update()` — меняет пароль, `mustChangePassword: false`
- **Response:** 200

### 2.5 Статистика (Admin)
- **Route:** `GET /api/user/admin/stats`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `userController.getAdminStats()`
- **Service:** `userService.getAdminStatsService()` → `statsService.fetchStatsInternal()`
  1. `prisma.user.count({ where: { role: 'USER' } })` — всего пользователей
  2. `prisma.user.count({ where: { role: 'MANAGER' } })` — всего менеджеров
  3. `getOnlineUsersFromSockets()` — количество online из Socket.IO
  4. Возврат `{ totalUsers, totalManagers, onlineCount, details: { onlineUsers, onlineManagers } }`
- **Response:** 200

---

## 3. Проекты (Projects)

### 3.1 Создание проекта
- **Route:** `POST /api/projects`
- **Middleware:** `authMiddleware` → `validate(createProjectSchema)`
- **Controller:** `projectController.createProject()`
  1. `projectService.createProject(req.body, req.user.id, logMeta)`
- **Service:** `projectService.createProject()`
  1. Проверка дубликата: `prisma.project.findFirst` по `customerInn` и статусу `PENDING/APPROVED/IN_PROGRESS` → throw 400
  2. `prisma.project.create()` — статус `PENDING`, `partnerId = userId`, `dynamicData` = остальные поля
  3. **Socket:** 
     - `io.to(\`user_${userId}\`).emit('project_created', project)`
     - `io.to('admin_room').emit('project_created', project)`
- **Socket Events:** `project_created` (в комнату пользователя и admin_room)
- **Response:** 201 `{ projectId, message: 'Заявка успешно создана и передана на модерацию' }`

### 3.2 Получение списка проектов
- **Route:** `GET /api/projects`
- **Middleware:** `authMiddleware`
- **Controller:** `projectController.getProjects()`
  1. `projectService.getProjects(req.user.id, req.user.role, req.query)`
- **Service:** `projectService.getProjects()`
  1. Если роль `USER` → `where.partnerId = userId`
  2. Поиск по `search` — `id`, `customerName`, `companyName`, `name` (для MANAGER/ADMIN)
  3. `prisma.project.findMany()` с `include: { partner, _count: { messages: { where: { isRead: false, senderId: { not: userId } } } } }`
  4. `prisma.project.count()`
  5. Обработка — преобразует `_count.messages` в `unreadCount` и `hasUnread`
  6. Возврат `{ projects, totalPages, currentPage, totalCount }`
- **Response:** 200

### 3.3 Обновление проекта
- **Route:** `PUT /api/projects/:id`
- **Middleware:** `authMiddleware` → `validate(updateProjectSchema)`
- **Controller:** `projectController.updateProject()`
  1. `projectService.updateProject(id, req.body, req.user.id, req.user.role, logMeta)`
- **Service:** `projectService.updateProject()`
  1. `prisma.project.findUnique()` — проверка существования
  2. Проверка прав: `partnerId !== userId && role !== 'MANAGER'` → throw 403
  3. `prisma.project.update()` — обновление полей
  4. **Socket:**
     - `io.to(\`user_${userId}\`).emit('project_updated', project)`
     - `io.to('admin_room').emit('project_updated', project)`
- **Socket Events:** `project_updated`
- **Response:** 200 `{ project, message: 'Проект обновлен' }`

### 3.4 Изменение статуса проекта
- **Route:** `PATCH /api/projects/:id/status`
- **Middleware:** `authMiddleware` → `managerMiddleware` → `validate(updateProjectStatusSchema)`
- **Controller:** `projectController.updateProjectStatus()`
  1. `projectService.updateProjectStatus(id, status, req.user.id, req.user.role, logMeta)`
- **Service:** `projectService.updateProjectStatus()`
  1. Проверка прав: `role !== 'MANAGER' && role !== 'ADMIN'` → throw 403
  2. `prisma.project.findUnique()` — проверка существования
  3. Проверка валидности статуса: `Object.values(ProjectStatus).includes(status)` → throw 400
  4. `prisma.project.update()` — меняет статус, `lastEditorId`, `updatedAt`
  5. **Socket:**
     - `io.to('admin_room').emit('project_status_changed', project)`
     - `io.to(\`user_${partnerId}\`).emit('project_status_changed', project)`
     - `emitStatsUpdate()`
  6. `logEvent({ action: 'status_changed', description: '...', entityType: 'project', entityId: id, userId })` (fire-and-forget)
- **Socket Events:** `project_status_changed` (admin_room + partner), `stats_updated`
- **Response:** 200 `{ project, message: 'Статус обновлен' }`

---

## 4. Чат (Messages)

### 4.1 Получение сообщений проекта
- **Route:** `GET /api/chat/:projectId/messages`
- **Middleware:** `authMiddleware`
- **Controller:** `chatController.getProjectMessages()`
  1. `chatService.getProjectMessages(projectId, req.user.id, req.user.role, logMeta)`
- **Service:** `chatService.getProjectMessages()`
  1. `prisma.project.findUnique({ select: { partnerId } })` — проверка существования
  2. Проверка доступа: `role !== 'MANAGER' && partnerId !== userId` → throw 403
  3. `prisma.message.findMany({ where: { projectId }, include: { sender }, orderBy: { createdAt: 'asc' } })`
- **Response:** 200 `[messages]`

### 4.2 Отправка сообщения
- **Route:** `POST /api/chat/:projectId/messages`
- **Middleware:** `authMiddleware` → `validate(sendMessageSchema)`
- **Controller:** `chatController.sendMessage()`
  1. `chatService.sendMessage(projectId, text, req.user.id, logMeta)`
- **Service:** `chatService.sendMessage()`
  1. `prisma.$transaction([prisma.message.create({ data: { text, projectId, senderId }, include: { sender } }), prisma.project.update({ where: { id: projectId }, data: { updatedAt: now } })])`
  2. **Socket:** `io.to(\`project_${projectId}\`).emit('new_message', message)`
- **Socket Events:** `new_message` (в комнату проекта)
- **Response:** 201 `{ message }`

### 4.3 Отметка сообщений как прочитанных
- **Route:** `PATCH /api/chat/:projectId/read`
- **Middleware:** `authMiddleware`
- **Controller:** `chatController.markAsRead()`
  1. `chatService.markMessagesAsRead(projectId, req.user.id, logMeta)`
- **Service:** `chatService.markMessagesAsRead()`
  1. `prisma.message.findMany({ where: { projectId, isRead: false, senderId: { not: userId } }, distinct: ['senderId'] })` — кто отправители
  2. `prisma.message.updateMany({ where: { projectId, isRead: false, senderId: { not: userId } }, data: { isRead: true } })`
  3. **Socket:** Если обновлено > 0:
     - Для каждого отправителя: `io.to(\`user_${senderId}\`).emit('messages_read', { projectId, readerId: userId })`
     - `io.to(\`project_${projectId}\`).emit('messages_read', { projectId, readerId: userId })`
- **Socket Events:** `messages_read` (в комнату отправителя и проекта)
- **Response:** 200 `{ success, updatedCount }`

---

## 5. Компании (Admin)

### 5.1 Список компаний
- **Route:** `GET /api/companies`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `companyController.getCompaniesList()`
  1. `companyService.getCompanies(search)`
- **Service:** `companyService.getCompanies()`
  1. `prisma.company.findMany({ where: { OR: [name/search, unp/search] }, take: 100, orderBy: { name: 'asc' }, select: { id, name, unp, phone } })`
- **Response:** 200

---

## 6. Менеджер (Manager)

### 6.1 Список партнёров
- **Route:** `GET /api/manager/partners`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `managerController.getPartners()`
  1. `prisma.user.findMany({ where: { role: 'USER' }, select: { id, email, companyName, unp, name }, orderBy: { companyName: 'asc' } })` — прямой запрос в контроллере
- **Response:** 200

### 6.2 Отправка рассылки (Broadcast)
- **Route:** `POST /api/manager/send-broadcast`
- **Middleware:** `authMiddleware` → `managerMiddleware` → `express.json({ limit: '50mb' })` → `validate(broadcastSchema)`
- **Controller:** `managerController.sendBroadcast()`
  1. `prisma.user.findMany({ where: { id: { in: recipientIds }, role: 'USER' }, select: { id, email, companyName } })`
  2. Если нет получателей → 400
  3. `Promise.allSettled(recipients.map(r => emailService.sendEmail({ to: r.email, subject, html: message, attachments })))`
  4. После ответа клиенту (fire-and-forget):
     - `broadcastLogService.logBroadcast({ subject, message, recipients, status, sentBy })` — запись в `broadcastLog`
     - `eventLogService.logEvent({ action: 'broadcast_sent', description, entityType: 'broadcast', userId })`
- **Response:** 200 `{ sent, failed, failedDetails? }`

### 6.3 Получение оборудования (список)
- **Route:** `GET /api/manager/equipment`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `equipmentController.listEquipment()`
  1. `equipmentService.getEquipmentList({ category, status, search, page, perPage })`
- **Service:** `equipmentService.getEquipmentList()`
  1. Построение `where` с фильтрами по `category`, `status`, `search` (name, serialNumber, macAddress, issuedTo)
  2. `prisma.testEquipment.findMany()` + `prisma.testEquipment.count()`
- **Response:** 200 `{ items, total, page, perPage }`

### 6.4 Получение оборудования (по ID)
- **Route:** `GET /api/manager/equipment/:id`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `equipmentController.getEquipment()`
  1. `equipmentService.getEquipmentById(id)` → `prisma.testEquipment.findUnique({ where: { id } })`
- **Response:** 200 или 404

### 6.5 Создание оборудования
- **Route:** `POST /api/manager/equipment`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `equipmentController.addEquipment()`
  1. `equipmentService.createEquipment(data)` → `prisma.testEquipment.create({ data })`
  2. `eventLogService.logEvent({ action: 'equipment_added', ... })` (fire-and-forget)
- **Response:** 200 `{ message: 'Оборудование добавлено' }`

### 6.6 Обновление оборудования
- **Route:** `PUT /api/manager/equipment/:id`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `equipmentController.editEquipment()`
  1. `equipmentService.updateEquipment(id, data)` → `prisma.testEquipment.update({ where: { id }, data })`
  2. `eventLogService.logEvent({ action: 'equipment_edited', ... })` (fire-and-forget)
- **Response:** 200 `{ message: 'Оборудование обновлено' }`

### 6.7 Удаление оборудования
- **Route:** `DELETE /api/manager/equipment/:id`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `equipmentController.removeEquipment()`
  1. `equipmentService.getEquipmentById(id)` — для лога имени
  2. `equipmentService.deleteEquipment(id)` → `prisma.testEquipment.delete({ where: { id } })`
  3. `eventLogService.logEvent({ action: 'equipment_deleted', ... })` (fire-and-forget)
- **Response:** 200 `{ message: 'Оборудование удалено' }`

### 6.8 Категории оборудования
- **Route:** `GET /api/manager/equipment/categories`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `equipmentController.listCategories()`
  1. `equipmentService.getEquipmentCategories()` → `prisma.testEquipment.findMany({ distinct: ['category'], orderBy: { category: 'asc' } })` → массив строк
- **Response:** 200

### 6.9 Список новостей (Manager)
- **Route:** `GET /api/manager/news`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `newsController.listNews()`
  1. `newsService.getNewsList()` → `prisma.news.findMany({ orderBy: { createdAt: 'desc' } })`
- **Response:** 200

### 6.10 Создание новости
- **Route:** `POST /api/manager/news`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `newsController.addNews()`
  1. Проверка `title` и `link` в контроллере
  2. `newsService.createNews({ title, link, imageUrl })` → `prisma.news.create({ data })`
  3. `eventLogService.logEvent({ action: 'news_added', ... })` (fire-and-forget)
- **Response:** 200 `{ message: 'Новость добавлена' }`

### 6.11 Удаление новости
- **Route:** `DELETE /api/manager/news/:id`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `newsController.removeNews()`
  1. `newsService.deleteNews(id)` → `prisma.news.delete({ where: { id } })`
  2. `eventLogService.logEvent({ action: 'news_deleted', ... })` (fire-and-forget)
- **Response:** 200 `{ message: 'Новость удалена' }`

### 6.12 Лог рассылок
- **Route:** `GET /api/manager/broadcast-log`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `broadcastLogController.listBroadcastLog()`
  1. `broadcastLogService.getBroadcastLog()` → `prisma.broadcastLog.findMany({ orderBy: { sentAt: 'desc' }, take: 50 })`
- **Response:** 200

### 6.13 Лог событий (Events)
- **Route:** `GET /api/manager/events`
- **Middleware:** `authMiddleware` → `managerMiddleware`
- **Controller:** `eventLogController.listEvents()`
  1. `eventLogService.getEventLog()` → `prisma.eventLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { user } })`
- **Response:** 200

---

## 7. Администрирование (Admin)

### 7.1 Логи (читает файлы логов)
- **Route:** `GET /api/admin/logs`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `adminController.getLogs()`
  1. Извлекает `level`, `search`, `limit`, `date` из `req.query`
  2. `adminService.fetchLogs(level, search, limit, date)`
- **Service:** `adminService.fetchLogs()`
  1. Поиск файлов `combined-YYYY-MM-DD.log` в папке `logs/`
  2. Чтение последних 1MB каждого файла (с конца)
  3. Парсинг JSON-строк, фильтрация по `level`, `search`
  4. Сортировка по убыванию `timestamp`
  5. Возврат `{ logs, total, returned }`
- **Response:** 200

### 7.2 Настройки: список всех (Admin)
- **Route:** `GET /api/admin/settings`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `settingsController.getAllAdminSettings()`
  1. `settingsService.getAllSettings()` → `prisma.siteSetting.findMany()` → объект `{ [key]: value }`
- **Response:** 200

### 7.3 Настройки: получить одну (Admin)
- **Route:** `GET /api/admin/settings/:key`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `settingsController.getAdminSetting()`
  1. `settingsService.getSetting(key)` → `prisma.siteSetting.findUnique({ where: { key } })` → `value` или `null`
- **Response:** 200

### 7.4 Настройки: обновить (Admin)
- **Route:** `PUT /api/admin/settings/:key`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `settingsController.updateSetting()`
  1. Извлекает `value` из `req.body`, проверка на `undefined`
  2. `settingsService.upsertSetting(key, value)` → `prisma.siteSetting.upsert({ where: { key }, create: { key, value }, update: { value } })`
- **Response:** 200 `{ message: 'Настройка сохранена' }`

### 7.5 Настройки: публичная (для всех авторизованных)
- **Route:** `GET /api/settings/:key`
- **Middleware:** `authMiddleware`
- **Controller:** `settingsController.getPublicSetting()`
  1. `settingsService.getSetting(key)` → `value` или `null`
- **Response:** 200

### 7.6 Новости: публичный список (для всех авторизованных)
- **Route:** `GET /api/news`
- **Middleware:** `authMiddleware`
- **Controller:** встроенный в роуте (inline)
  1. `newsService.getNewsList()` → `prisma.news.findMany({ orderBy: { createdAt: 'desc' } })`
- **Response:** 200

### 7.7 DB Browser: список таблиц
- **Route:** `GET /api/admin/db/tables`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `dbController.listTables()`
  1. `dbService.getTables()` → для каждой из `['Company', 'User', 'Project', 'Message']`:
     - `prisma.$queryRawUnsafe` для получения колонок из `information_schema.columns`
     - Определение PK, readOnly полей
  2. Возврат `[{ name, columns }]`
- **Response:** 200

### 7.8 DB Browser: данные таблицы
- **Route:** `GET /api/admin/db/tables/:tableName`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `dbController.readTable()`
  1. `dbService.getTableData(tableName, { page, perPage, search })`
- **Service:** `dbService.getTableData()`
  1. Проверка `assertTableAllowed(tableName)`
  2. Получение информации о колонках
  3. Определение PK для ORDER BY
  4. Построение `WHERE` с ILIKE по поисковым колонкам (кроме password)
  5. `prisma.$queryRawUnsafe('SELECT COUNT(*) ...')`
  6. `prisma.$queryRawUnsafe('SELECT * ... ORDER BY pk DESC LIMIT perPage OFFSET offset')`
  7. Возврат `{ data, total, page, perPage, columns }`
- **Response:** 200

### 7.9 DB Browser: обновление строки
- **Route:** `PUT /api/admin/db/tables/:tableName/:id`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `dbController.updateRow()`
  1. `dbService.updateTableRow(tableName, rowId, req.body)`
- **Service:** `dbService.updateTableRow()`
  1. Проверка `assertTableAllowed(tableName)`
  2. Исключение PK и readOnly полей из обновляемых
  3. `prisma.$executeRawUnsafe('UPDATE ... SET ... WHERE pk = $N')`
  4. Обработка ошибок PostgreSQL: enum, unique, foreign key, not-null
- **Response:** 200 `{ message: 'Строка обновлена' }`

### 7.10 Бэкап: создание
- **Route:** `POST /api/admin/backup/create`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `backupController.createBackupHandler()`
  1. `backupService.createBackup()`
- **Service:** `backupService.createBackup()`
  1. Проверка Docker: `docker ps` — если нет → `{ success: false }`
  2. Проверка контейнера: `docker ps --filter name=projects_postgres_18`
  3. `exec('docker exec $CONTAINER pg_dump -U admin -d b2b_portal --clean --if-exists')`
  4. Запись stdout в файл `backups/backup_TIMESTAMP.sql`
  5. Возврат `{ success, filename }`
- **Response:** 200 `{ filename }` или 500

### 7.11 Бэкап: загрузка файла
- **Route:** `POST /api/admin/backup/upload`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `backupController.uploadBackupHandler()`
  1. `uploadMiddleware(req, res, cb)` — multer single('backup'), .sql only, 500MB max
  2. Сохранение в `backups/` директорию
- **Response:** 200 `{ filename }` или 400/413

### 7.12 Бэкап: список
- **Route:** `GET /api/admin/backup/list`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `backupController.listBackupsHandler()`
  1. `backupService.listBackups()` — читает `backups/` директорию, сортирует `.sql` файлы
  2. Для каждого: `stat` → размер, дата из имени файла
- **Response:** 200 `[{ filename, sizeBytes, sizeHuman, createdAt }]`

### 7.13 Бэкап: скачать
- **Route:** `GET /api/admin/backup/download/:filename`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `backupController.downloadBackupHandler()`
  1. Защита от directory traversal: `filename.includes('..')` и т.д.
  2. `getBackupPath(filename)` → проверка `fs.promises.access()`
  3. `res.download(filepath, filename)`
- **Response:** 200 (файл) или 400/404

### 7.14 Бэкап: удалить
- **Route:** `DELETE /api/admin/backup/:filename`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `backupController.deleteBackupHandler()`
  1. `backupService.deleteBackup(filename)` → `fs.unlink()` в `backups/`
- **Response:** 200 или 404

### 7.15 Бэкап: восстановление
- **Route:** `POST /api/admin/backup/restore/:filename`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `backupController.restoreBackupHandler()`
  1. `backupService.restoreBackup(filename)`
- **Service:** `backupService.restoreBackup()`
  1. Защита от directory traversal
  2. Проверка существования файла
  3. Проверка Docker и контейнера
  4. Чтение файла → `spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME])`
  5. `proc.stdin.write(sqlContent)`, `proc.stdin.end()`
  6. Ожидание `close` кода
- **Response:** 200 или 500

### 7.16 Бэкап: расписание (получить)
- **Route:** `GET /api/admin/backup/schedule`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `backupController.getScheduleHandler()`
  1. `backupService.getSchedule()` → `{ enabled: boolean, cron: string | null }`
- **Response:** 200

### 7.17 Бэкап: расписание (установить)
- **Route:** `PUT /api/admin/backup/schedule`
- **Middleware:** `authMiddleware` → `adminMiddleware`
- **Controller:** `backupController.setScheduleHandler()`
  1. Извлекает `cron` из `req.body`
  2. `backupService.setSchedule(cronExpr)`
- **Service:** `backupService.setSchedule()`
  1. Останавливает старую задачу (`scheduledTask.stop()`)
  2. Если `cronExpr` пуст → отключает
  3. Валидация `cron.validate()`
  4. `cron.schedule(cronExpr, async () => { await createBackup(); if onBackupComplete -> callback })`
  5. Возврат `{ success }` или `{ success: false, error }`
- **Response:** 200 `{ enabled, cron }` или 400

---

## 8. Socket.IO (Server-side events)

Все Socket.IO события, которые сервер отправляет клиентам:

| Событие | Куда | Когда |
|---------|------|-------|
| `session_superseded` | `user_${userId}` | При логине/2FA если уже была активная сессия |
| `user:online` | `admin_room` | При подключении сокета (не ADMIN) |
| `user:offline` | `admin_room` | При отключении сокета (disconnect/logout) |
| `user_status_changed` | `admin_room` | При 2FA verify, logout, изменении lastSeen |
| `user:blocked_status_changed` | `admin_room` | При блокировке/разблокировке, сбросе failedLoginAttempts, 2FA блокировке |
| `user_blocked` | `user_${userId}` | При ручной блокировке администратором |
| `user_unblocked_by_admin` | `user_${userId}` | При снятии системной блокировки |
| `stats_updated` | `admin_room` | При логине, logout, 2FA verify, блокировке, удалении пользователя, изменении статуса проекта |
| `project_created` | `user_${partnerId}` + `admin_room` | При создании проекта |
| `project_updated` | `user_${userId}` + `admin_room` | При обновлении проекта |
| `project_status_changed` | `user_${partnerId}` + `admin_room` | При изменении статуса проекта |
| `new_message` | `project_${projectId}` | При отправке сообщения |
| `messages_read` | `user_${senderId}` + `project_${projectId}` | При отметке сообщений как прочитанных |

Клиентские события (с сервера → клиент):
- `join_project({ projectId })` — клиент присоединяется к комнате проекта
- `user_logging_out` — клиент уведомляет о выходе

---

## 9. Middleware

### authMiddleware
1. Извлечение токена из `Authorization: Bearer <token>` или `cookie: jwt`
2. `jwt.verify(token, JWT_SECRET)` → `{ id, sessionId }`
3. `prisma.user.findUnique({ where: { id } })` — проверка существования и `isBlocked`
4. Проверка `currentSessionId` против `decoded.sessionId` (superseded detection)
5. Проверка неактивности: USER — 30 мин, MANAGER/ADMIN — 120 мин
6. Обновление `lastSeen` если прошло > 60 сек (fire-and-forget)
7. Установка `req.user` и `req.logMeta`

### adminMiddleware
- Проверка `req.user.role === 'ADMIN'` → 403 если нет

### managerMiddleware
- Проверка `req.user.role === 'MANAGER'` → 403 если нет

---

## 10. Вспомогательные сервисы

### smsService.sendSms()
- HTTP GET запрос к `https://smart-sender.a1.by/api/send/sms` с параметрами `user`, `apikey`, `msisdn`, `sender`, `text`
- Парсинг JSON ответа, возврат `{ success, messageId?, error? }`

### emailService.sendEmail()
- Nodemailer transport (SMTP)
- Отправка письма с опциональными вложениями

### eventLogService.logEvent()
- `prisma.eventLog.create({ data })` — fire-and-forget (catch пустой)

### broadcastLogService.logBroadcast()
- `prisma.broadcastLog.create({ data })` — синхронный

### statsService
- `setIo(io)` / `getIo()` — глобальный access к Socket.IO
- `fetchStatsInternal()` — подсчёт пользователей/менеджеров + online
- `emitStatsUpdate()` — вычисляет и шлёт `stats_updated` в `admin_room`
- `emitUserLockStatus(userId, updates)` — шлёт `user:blocked_status_changed` в `admin_room`
- `getOnlineUsersFromSockets()` — обходит все сокеты для подсчёта online
