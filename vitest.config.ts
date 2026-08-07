import { defineConfig } from 'vitest/config'

export default defineConfig({
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
