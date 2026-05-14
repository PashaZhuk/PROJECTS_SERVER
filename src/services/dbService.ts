import { prisma } from '../config/db.js';

// ─── Только эти таблицы доступны для просмотра/редактирования ───
const ALLOWED_TABLES = ['Company', 'User', 'Project', 'SiteSetting', 'Message'];

// ─── Read-only поля (автоматические, не подлежат ручной правке) ───
const READ_ONLY_FIELDS: Record<string, string[]> = {
  Company:     ['createdAt', 'updatedAt'],
  User:        ['password', 'resetPasswordToken', 'resetPasswordExpires',
                'currentSessionId', 'createdAt', 'updatedAt', 'lastSeen'],
  Project:     ['createdAt', 'updatedAt'],
  SiteSetting: ['createdAt', 'updatedAt'],
  Message:     ['createdAt'],
};

function assertTableAllowed(name: string): asserts name is typeof ALLOWED_TABLES[number] {
  if (!ALLOWED_TABLES.includes(name)) {
    throw new Error(`Table "${name}" is not allowed`);
  }
}

// ─── Типы ───

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  is_pk: boolean;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPk: boolean;
  readOnly: boolean;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

interface CountRow {
  count: bigint;
}

// ─── Сервисы ───

/** Получить колонки таблицы */
async function getTableInfo(name: string): Promise<TableInfo> {
  assertTableAllowed(name);
  const roFields = READ_ONLY_FIELDS[name] || [];

  const rows = await prisma.$queryRawUnsafe<ColumnRow[]>(
    `SELECT
       c.column_name,
       c.data_type,
       c.is_nullable,
       (EXISTS (
         SELECT 1 FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_catalog = kcu.constraint_catalog
          AND tc.constraint_schema  = kcu.constraint_schema
          AND tc.constraint_name    = kcu.constraint_name
         WHERE tc.table_catalog = (SELECT current_database())
           AND tc.table_schema = 'public'
           AND tc.table_name = c.table_name
           AND kcu.column_name = c.column_name
           AND tc.constraint_type = 'PRIMARY KEY'
       )) as is_pk
     FROM information_schema.columns c
     WHERE c.table_name = '${name}' AND c.table_schema = 'public'
     ORDER BY c.ordinal_position`
  );

  return {
    name,
    columns: rows.map(r => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
      isPk: !!r.is_pk,
      readOnly: roFields.includes(r.column_name),
    })),
  };
}

/** Список всех разрешённых таблиц с их колонками */
export async function getTables(): Promise<TableInfo[]> {
  const results: TableInfo[] = [];
  for (const name of ALLOWED_TABLES) {
    results.push(await getTableInfo(name));
  }
  return results;
}

/** Текстовые/поисковые типы колонок */
const SEARCHABLE_TYPES = [
  'character varying', 'character', 'text',
  'varchar', 'char',
  'integer', 'bigint', 'numeric',
];

function isSearchableType(type: string): boolean {
  return SEARCHABLE_TYPES.some(t => type.startsWith(t));
}

/** Данные таблицы с пагинацией и поиском */
export async function getTableData(
  tableName: string,
  params: { page?: number; perPage?: number; search?: string }
): Promise<{
  data: Record<string, unknown>[];
  total: number;
  page: number;
  perPage: number;
  columns: ColumnInfo[];
}> {
  assertTableAllowed(tableName);

  const page = Math.max(1, params.page || 1);
  const perPage = Math.min(100, Math.max(1, params.perPage || 25));
  const offset = (page - 1) * perPage;
  const search = params.search?.trim() || '';
  const info = await getTableInfo(tableName);

  // Определяем PK-колонку для ORDER BY
  const pkCol = info.columns.find(c => c.isPk) || info.columns[0];
  if (!pkCol) throw new Error(`Таблица "${tableName}" не содержит колонок`);
  const pkName = pkCol.name;

  // Строим WHERE для поиска
  let whereClause = '';
  const searchableCols = info.columns.filter(c => isSearchableType(c.type) && !['password'].includes(c.name));
  if (search && searchableCols.length > 0) {
    const conditions = searchableCols
      .map(c => `CAST("${c.name}" AS text) ILIKE '%${search.replace(/'/g, "''")}%'`)
      .join(' OR ');
    whereClause = `WHERE ${conditions}`;
  }

  // Total count
  const countRows = await prisma.$queryRawUnsafe<CountRow[]>(
    `SELECT COUNT(*) as count FROM "${tableName}" ${whereClause}`
  );
  const total = Number(countRows[0]?.count ?? 0);

  // Данные
  const data = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM "${tableName}" ${whereClause} ORDER BY "${pkName}" DESC LIMIT ${perPage} OFFSET ${offset}`
  );

  return { data, total, page, perPage, columns: info.columns };
}

/** Обновить строку в таблице */
export async function updateTableRow(
  tableName: string,
  rowId: number,
  updates: Record<string, unknown>
): Promise<void> {
  assertTableAllowed(tableName);

  const info = await getTableInfo(tableName);
  const roFields = READ_ONLY_FIELDS[tableName] || [];

  const pkCol = info.columns.find(c => c.isPk);
  if (!pkCol) throw new Error(`Table "${tableName}" has no primary key`);

  // Убираем PK и read-only поля из обновляемых
  const setFields = Object.entries(updates).filter(([key]) =>
    key !== pkCol.name && !roFields.includes(key)
  );

  if (setFields.length === 0) return;

  const setClause = setFields
    .map(([key], i) => `"${key}" = $${i + 1}`)
    .join(', ');

  const values = setFields.map(([, val]) => {
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      return JSON.stringify(val);
    }
    return val;
  });

  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "${tableName}" SET ${setClause} WHERE "${pkCol.name}" = $${setFields.length + 1}`,
      ...values,
      rowId
    );
  } catch (err: any) {
    // Перехватываем ошибки PostgreSQL и превращаем в понятные сообщения
    const msg = String(err?.message || '');

    // Ошибка enum — неверное значение для перечисления
    if (msg.includes('invalid input value for enum')) {
      // Парсим: "invalid input value for enum projectstatus: \"aproved\""
      const match = msg.match(/for enum\s+(\S+):\s*"([^"]+)"/i);
      if (match) {
        const enumName = match[1];
        const badValue = match[2];
        throw new Error(
          `Недопустимое значение "${badValue}" для поля статуса. ` +
          `Допустимые: PENDING, IN_PROGRESS, APPROVED, REJECTED, REVISION, CLOSED`
        );
      }
      throw new Error('Недопустимое значение для поля-перечисления');
    }

    // Ошибка unique constraint
    if (msg.includes('duplicate key value violates unique constraint')) {
      throw new Error('Запись с таким значением уже существует (нарушение уникальности)');
    }

    // Ошибка foreign key
    if (msg.includes('violates foreign key constraint')) {
      throw new Error('Недопустимая ссылка на связанную запись (нарушение внешнего ключа)');
    }

    // Ошибка NOT NULL
    if (msg.includes('null value in column') && msg.includes('violates not-null constraint')) {
      const colMatch = msg.match(/column "([^"]+)"/);
      const colName = colMatch ? colMatch[1] : '';
      throw new Error(`Поле "${colName}" не может быть пустым`);
    }

    // Любая другая PG ошибка
    if (msg.includes('"') && (msg.includes('relation') || msg.includes('column') || msg.includes('type'))) {
      throw new Error('Ошибка базы данных: проверьте правильность введённых данных');
    }

    // Пробрасываем как есть (не PG ошибка)
    throw err;
  }
}
