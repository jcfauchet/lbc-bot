import { execSync } from 'child_process'

const isProduction = process.env.NODE_ENV === 'production'

async function runMigrations() {
  try {
    if (isProduction) {
      console.log('🔄 Running database migrations (production)...')
      execSync('prisma migrate deploy', { stdio: 'inherit' })
      console.log('✅ Migrations completed')
    } else {
      console.log('⚠️  Skipping migrations in development mode')
      console.log('   Run "pnpm db:migrate" manually to create/apply migrations')
    }
  } catch (error) {
    console.error('❌ Migration failed:', error)
    if (isProduction) {
      process.exit(1)
    }
  }
}

runMigrations()

