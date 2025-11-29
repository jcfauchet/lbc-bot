import { execSync } from 'child_process'

const directUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL

if (!directUrl) {
  console.error('❌ DATABASE_DIRECT_URL or DATABASE_URL must be set')
  process.exit(1)
}

process.env.DATABASE_DIRECT_URL = directUrl

try {
  console.log('🔄 Running database migrations...')
  execSync('prisma migrate deploy', { stdio: 'inherit', env: process.env })
  console.log('✅ Migrations completed')
} catch (error) {
  console.error('❌ Migration failed:', error)
  process.exit(1)
}

