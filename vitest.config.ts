import { defineConfig } from 'vitest/config'

// Windows-костыль: vite/vitest резолвят пути case-sensitively. Если терминал
// открыт со строчной буквой диска (d:\Hermes\...) — ломается загрузка конфига
// и моков («Cannot read properties of undefined (reading 'config')»,
// «failed to find the runner»). Нормализуем букву диска в верхний регистр.
const normalizedRoot = process.cwd().replace(/^([a-z]):/, (_m, letter: string) => `${letter.toUpperCase()}:`)

export default defineConfig({
  root: normalizedRoot,
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: true,
    // forks: полная изоляция модулей между файлами.
    // vmThreads протекал: тестовые моки (emailService transporter/logger) попадали
    // в другие файлы → недетерминированные падения полного прогона (0–37 failed).
    pool: 'forks',
    fileParallelism: false,
    // Исключаем dist — vitest не должен подхватывать скомпилированные тесты
    exclude: ['node_modules/**', 'dist/**', 'backups/**', 'logs/**'],
  },
})
