import { execSync } from 'child_process'

const TEST_DATABASE_URL =
  'postgresql://admin:testpass@127.0.0.1:5433/b2b_portal_test?schema=public'

export async function setup() {
  process.env.DATABASE_URL = TEST_DATABASE_URL

  console.log('⏳ Running migrations on test DB...')
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    cwd: process.cwd(),
    stdio: 'pipe',
  })
  console.log('✅ Test DB migrations applied')
}

export async function teardown() {
  // nothing to clean — DB is ephemeral (tmpfs)
}
