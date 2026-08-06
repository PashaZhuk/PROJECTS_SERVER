import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: true,
    pool: 'vmThreads',
    fileParallelism: false,
    // Исключаем dist — vitest не должен подхватывать скомпилированные тесты
    exclude: ['node_modules/**', 'dist/**', 'backups/**', 'logs/**'],
  },
})
