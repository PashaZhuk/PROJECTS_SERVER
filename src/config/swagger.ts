import swaggerJsdoc from 'swagger-jsdoc'

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'IPMATIKA Bel B2B Portal API',
      version: '1.0.0',
      description:
        'B2B-портал для партнёров IPMATIKA. Управление проектами, заказами, оборудованием.',
    },
    servers: [
      { url: 'http://localhost:5001/api', description: 'Development' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'jwt',
          description: 'JWT access token в httpOnly cookie',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', enum: [false] },
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object' },
            message: { type: 'string' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            email: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['ADMIN', 'MANAGER', 'USER'] },
            companyName: { type: 'string' },
          },
        },
        LoginInput: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
          },
        },
        News: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            content: { type: 'string' },
            link: { type: 'string', nullable: true },
            category: { type: 'string', enum: ['NEWS', 'NOMENCLATURE', 'DEMO'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    paths: {
      // ========================
      // SYSTEM
      // ========================
      '/health': {
        get: {
          tags: ['System'],
          summary: 'Health-check: статус сервера и БД (S1)',
          responses: {
            '200': {
              description: 'Сервер и БД работают',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['ok'] },
                      db: { type: 'boolean', enum: [true] },
                      uptime: { type: 'number' },
                    },
                  },
                },
              },
            },
            '503': { description: 'БД недоступна (db: false)' },
          },
        },
      },
      // ========================
      // AUTH
      // ========================
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Вход в систему',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginInput' } } },
          },
          responses: {
            '200': {
              description: 'Успешный вход. 2FA_REQUIRED — для всех ролей (обязательна с 03.06.2026). userId НЕ возвращается — сервер ставит preauth cookie',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/Success' },
                      {
                        type: 'object',
                        properties: {
                          success: { type: 'boolean', enum: [true] },
                          status: { type: 'string', enum: ['2FA_REQUIRED'] },
                          message: { type: 'string' },
                          data: {
                            type: 'object',
                            properties: {
                              email: { type: 'string' },
                              requires2FA: { type: 'boolean' },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            '401': { description: 'Неверные учетные данные' },
            '429': { description: 'Rate limit 10/мин или блокировка аккаунта' },
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Выход из системы',
          responses: {
            '200': { description: 'Успешный выход' },
          },
        },
      },
      '/auth/profile': {
        get: {
          tags: ['Auth'],
          summary: 'Профиль текущего пользователя',
          security: [{ cookieAuth: [] }, { bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Данные пользователя',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
            },
            '401': { description: 'Не авторизован' },
          },
        },
      },
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Регистрация пользователя (только ADMIN)',
          security: [{ cookieAuth: [] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password', 'role'],
                  properties: {
                    email: { type: 'string' },
                    password: { type: 'string' },
                    role: { type: 'string', enum: ['USER', 'MANAGER'] },
                    companyName: { type: 'string' },
                    unp: { type: 'string' },
                    phone: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Пользователь создан' },
            '400': { description: 'Ошибка валидации' },
          },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Ротация refresh токена (rate limit 10/мин)',
          responses: {
            '200': { description: 'Токен обновлён' },
            '401': { description: 'Невалидный или истёкший токен' },
            '429': { description: 'Rate limit 10/мин' },
          },
        },
      },
      '/auth/2fa/send': {
        post: {
          tags: ['Auth', '2FA'],
          summary: 'Отправить 2FA код по SMS (B4: userId из preauth cookie, тело пустое)',
          responses: {
            '200': { description: 'Код отправлен. debugCode возвращается только в dev (NODE_ENV !== production)' },
            '401': { description: 'Preauth-сессия истекла (PREAUTH_EXPIRED)' },
            '429': { description: 'Rate limit 3/мин или блокировка' },
          },
        },
      },
      '/auth/2fa/verify': {
        post: {
          tags: ['Auth', '2FA'],
          summary: 'Проверить 2FA код (B4: userId из preauth cookie)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code'],
                  properties: {
                    code: { type: 'string', minLength: 6, maxLength: 6 },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: '2FA пройдена, токены выданы' },
            '401': { description: 'Неверный код или preauth-сессия истекла (PREAUTH_EXPIRED)' },
            '429': { description: 'Rate limit 3/мин или блокировка после 3 попыток' },
          },
        },
      },
      '/auth/forgot-password': {
        post: {
          tags: ['Auth'],
          summary: 'Запрос сброса пароля (rate limit 3/час)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: { email: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Письмо отправлено (если email существует)' },
            '429': { description: 'Rate limit 3/час' },
          },
        },
      },
      '/auth/reset-password': {
        post: {
          tags: ['Auth'],
          summary: 'Сброс пароля по токену',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['token', 'newPassword'],
                  properties: {
                    token: { type: 'string' },
                    newPassword: { type: 'string', minLength: 6 },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Пароль изменён' },
            '400': { description: 'Недействительный или истёкший токен' },
          },
        },
      },

      // ========================
      // USERS
      // ========================
      '/user/users': {
        get: {
          tags: ['Users'],
          summary: 'Список пользователей (ADMIN)',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Список пользователей с пагинацией' },
          },
        },
      },
      '/user/users/{id}': {
        delete: {
          tags: ['Users'],
          summary: 'Удалить пользователя (ADMIN)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Пользователь удалён' } },
        },
      },
      '/user/users/{id}/block': {
        patch: {
          tags: ['Users'],
          summary: 'Заблокировать/разблокировать пользователя (ADMIN)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Статус блокировки изменён' } },
        },
      },
      '/user/change-password': {
        post: {
          tags: ['Users'],
          summary: 'Смена пароля',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['currentPassword', 'newPassword'],
                  properties: {
                    currentPassword: { type: 'string' },
                    newPassword: { type: 'string', minLength: 6 },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Пароль изменён' } },
        },
      },
      '/user/admin/stats': {
        get: {
          tags: ['Admin'],
          summary: 'Статистика для админа',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              description: 'Статистика',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      totalUsers: { type: 'integer' },
                      totalManagers: { type: 'integer' },
                      onlineCount: { type: 'integer' },
                      details: {
                        type: 'object',
                        properties: {
                          onlineUsers: { type: 'integer' },
                          onlineManagers: { type: 'integer' },
                          onlineUserNames: { type: 'array', items: { type: 'string' } },
                          onlineManagerNames: { type: 'array', items: { type: 'string' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ========================
      // PROJECTS
      // ========================
      '/projects': {
        get: {
          tags: ['Projects'],
          summary: 'Список проектов',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Список проектов' } },
        },
        post: {
          tags: ['Projects'],
          summary: 'Создать проект',
          security: [{ cookieAuth: [] }],
          responses: { '201': { description: 'Проект создан' } },
        },
      },
      '/projects/{id}': {
        put: {
          tags: ['Projects'],
          summary: 'Обновить проект',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Проект обновлён' } },
        },
      },
      '/projects/{id}/status': {
        patch: {
          tags: ['Projects'],
          summary: 'Изменить статус проекта (MANAGER)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { status: { type: 'string' } },
                },
              },
            },
          },
          responses: { '200': { description: 'Статус изменён' } },
        },
      },

      // ========================
      // CHAT
      // ========================
      '/chat/{projectId}/messages': {
        get: {
          tags: ['Chat'],
          summary: 'История сообщений проекта',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'projectId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Сообщения' } },
        },
        post: {
          tags: ['Chat'],
          summary: 'Отправить сообщение',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'projectId', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    fileUrl: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Сообщение отправлено' } },
        },
      },
      '/chat/{projectId}/read': {
        patch: {
          tags: ['Chat'],
          summary: 'Отметить сообщения как прочитанные',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'projectId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Отмечено' } },
        },
      },

      // ========================
      // ADMIN
      // ========================
      '/admin/logs': {
        get: {
          tags: ['Admin'],
          summary: 'Логи сервера',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'level', in: 'query', schema: { type: 'string', enum: ['info', 'warn', 'error'] } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: { '200': { description: 'Логи' } },
        },
      },
      '/admin/logs/download': {
        get: {
          tags: ['Admin'],
          summary: 'Скачать логи (JSON)',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'dateFrom', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
            { name: 'level', in: 'query', schema: { type: 'string', enum: ['info', 'warn', 'error'] } },
          ],
          responses: { '200': { description: 'Файл логов', content: { 'application/octet-stream': {} } } },
        },
      },
      '/admin/settings': {
        get: {
          tags: ['Admin'],
          summary: 'Все настройки портала',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Список настроек' } },
        },
      },
      '/admin/settings/{key}': {
        get: {
          tags: ['Admin'],
          summary: 'Получить настройку по ключу',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Значение настройки' } },
        },
        put: {
          tags: ['Admin'],
          summary: 'Обновить настройку',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: { '200': { description: 'Настройка обновлена' } },
        },
      },
      '/admin/db/tables': {
        get: {
          tags: ['Admin', 'DB Browser'],
          summary: 'Список таблиц (whitelist)',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Список таблиц' } },
        },
      },
      '/admin/db/tables/{tableName}': {
        get: {
          tags: ['Admin', 'DB Browser'],
          summary: 'Данные таблицы',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Строки таблицы' } },
        },
      },
      '/admin/db/tables/{tableName}/{id}': {
        put: {
          tags: ['Admin', 'DB Browser'],
          summary: 'Редактировать строку',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Строка обновлена' } },
        },
      },
      '/admin/backup/create': {
        post: {
          tags: ['Admin', 'Backup'],
          summary: 'Создать бэкап БД',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Бэкап создан' } },
        },
      },
      '/admin/backup/upload': {
        post: {
          tags: ['Admin', 'Backup'],
          summary: 'Загрузить бэкап (multipart)',
          security: [{ cookieAuth: [] }],
          requestBody: {
            content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } },
          },
          responses: { '200': { description: 'Бэкап загружен' } },
        },
      },
      '/admin/backup/list': {
        get: {
          tags: ['Admin', 'Backup'],
          summary: 'Список бэкапов',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Список файлов' } },
        },
      },
      '/admin/backup/{filename}': {
        delete: {
          tags: ['Admin', 'Backup'],
          summary: 'Удалить бэкап',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Бэкап удалён' } },
        },
      },
      '/admin/backup/download/{filename}': {
        get: {
          tags: ['Admin', 'Backup'],
          summary: 'Скачать бэкап',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Файл бэкапа', content: { 'application/octet-stream': {} } },
          },
        },
      },
      '/admin/backup/restore/{filename}': {
        post: {
          tags: ['Admin', 'Backup'],
          summary: 'Восстановить из бэкапа',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'БД восстановлена' } },
        },
      },
      '/admin/backup/schedule': {
        get: {
          tags: ['Admin', 'Backup'],
          summary: 'Получить расписание бэкапов',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Расписание' } },
        },
        put: {
          tags: ['Admin', 'Backup'],
          summary: 'Установить расписание бэкапов',
          security: [{ cookieAuth: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    cronExpression: { type: 'string', example: '0 3 * * *' },
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Расписание обновлено' } },
        },
      },

      // ========================
      // COMPANIES
      // ========================
      '/companies': {
        get: {
          tags: ['Companies'],
          summary: 'Список компаний (ADMIN)',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Список компаний' } },
        },
      },

      // ========================
      // MANAGER
      // ========================
      '/manager/partners': {
        get: {
          tags: ['Manager'],
          summary: 'Список партнёров',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Партнёры' } },
        },
      },
      '/manager/send-broadcast': {
        post: {
          tags: ['Manager'],
          summary: 'Отправить рассылку',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Рассылка отправлена' } },
        },
      },
      '/manager/equipment': {
        get: {
          tags: ['Manager', 'Equipment'],
          summary: 'Список оборудования',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Оборудование' } },
        },
        post: {
          tags: ['Manager', 'Equipment'],
          summary: 'Добавить оборудование',
          security: [{ cookieAuth: [] }],
          responses: { '201': { description: 'Добавлено' } },
        },
      },
      '/manager/equipment/categories': {
        get: {
          tags: ['Manager', 'Equipment'],
          summary: 'Категории оборудования',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Список категорий' } },
        },
      },
      '/manager/equipment/{id}': {
        get: {
          tags: ['Manager', 'Equipment'],
          summary: 'Детали оборудования',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Детали' } },
        },
        put: {
          tags: ['Manager', 'Equipment'],
          summary: 'Изменить оборудование',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Обновлено' } },
        },
        delete: {
          tags: ['Manager', 'Equipment'],
          summary: 'Удалить оборудование',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Удалено' } },
        },
      },
      '/manager/news': {
        get: {
          tags: ['Manager', 'News'],
          summary: 'Список новостей (менеджер)',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Новости' } },
        },
        post: {
          tags: ['Manager', 'News'],
          summary: 'Создать новость',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'content'],
                  properties: {
                    title: { type: 'string', description: 'Заголовок (обяз)' },
                    content: { type: 'string', description: 'Текст новости (обяз)' },
                    link: { type: 'string', description: 'Ссылка (опционально)' },
                    category: { type: 'string', enum: ['NEWS', 'NOMENCLATURE', 'DEMO'], default: 'NEWS' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Новость создана' }, '400': { description: 'Нет title или content' } },
        },
      },
      '/manager/news/{id}': {
        put: {
          tags: ['Manager', 'News'],
          summary: 'Редактировать новость',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    content: { type: 'string' },
                    link: { type: 'string' },
                    category: { type: 'string', enum: ['NEWS', 'NOMENCLATURE', 'DEMO'] },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Новость обновлена' } },
        },
        delete: {
          tags: ['Manager', 'News'],
          summary: 'Удалить новость',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Новость удалена' } },
        },
      },
      '/manager/broadcast-log': {
        get: {
          tags: ['Manager'],
          summary: 'Журнал рассылок',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'Журнал' } },
        },
      },
      '/manager/events': {
        get: {
          tags: ['Manager'],
          summary: 'История событий',
          security: [{ cookieAuth: [] }],
          responses: { '200': { description: 'События' } },
        },
      },

      // ========================
      // 1C INTEGRATION
      // ========================
      '/integration/partner': {
        get: {
          tags: ['1C Integration'],
          summary: 'Поиск партнёра по УНП (прокси к 1С)',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'unp', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{9}$', description: '9 цифр УНП' } },
          ],
          responses: {
            '200': {
              description: 'Данные партнёра',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      unp: { type: 'string' },
                      phoneB2B: { type: 'string' },
                      emailB2B: { type: 'string' },
                    },
                  },
                },
              },
            },
            '400': { description: 'Невалидный УНП' },
            '502': { description: 'Ошибка 1С' },
          },
        },
      },
      '/integration/partner-finance': {
        get: {
          tags: ['1C Integration'],
          summary: 'Финансовая информация партнёра (прокси к 1С)',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'unp', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{9}$' } },
          ],
          responses: {
            '200': {
              description: 'Финансовые данные',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      unp: { type: 'string' },
                      partnerName: { type: 'string' },
                      totalOpenShipped: { type: 'number' },
                      totalOverdue: { type: 'number' },
                      totalPrepayment: { type: 'number' },
                      dataAsOf: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
            '400': { description: 'Невалидный УНП' },
            '502': { description: 'Ошибка 1С' },
          },
        },
      },
      '/integration/reconciliation-statement': {
        get: {
          tags: ['1C Integration'],
          summary: 'Скачать акт сверки (прокси к 1С)',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'unp', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{9}$' } },
            { name: 'year', in: 'query', required: false, schema: { type: 'integer', description: 'Год для квартального акта' } },
            { name: 'quarter', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 4, description: 'Номер квартала (1-4)' } },
          ],
          responses: {
            '200': {
              description: 'PDF/docx файл акта сверки',
              content: { 'application/octet-stream': {} },
            },
            '400': { description: 'Невалидные параметры' },
            '502': { description: 'Ошибка 1С' },
          },
        },
      },

      // ========================
      // PUBLIC
      // ========================
      '/news': {
        get: {
          tags: ['Public'],
          summary: 'Новости (фильтр по категории)',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string', enum: ['NEWS', 'NOMENCLATURE', 'DEMO'] } },
          ],
          responses: { '200': { description: 'Список новостей (orderBy: createdAt desc)' } },
        },
      },
      '/settings/{key}': {
        get: {
          tags: ['Public'],
          summary: 'Публичная настройка',
          parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Значение настройки' } },
        },
      },
    },
  },
  apis: [],
}

export const swaggerSpec = swaggerJsdoc(options)
