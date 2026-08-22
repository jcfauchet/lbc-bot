import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { env } from '@/infrastructure/config/env'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

const pool =
  globalForPrisma.pool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    // node-postgres reaps idle connections after 10s by default. The crons sit
    // idle far longer than that *inside* a single run -- the scraper sleeps
    // 5-13s between searches to stay under DataDome's radar, and the analysis
    // waits on AI calls -- so every gap dropped the connection and the next
    // query paid a fresh Supavisor handshake. That churn shows up as ~31
    // `pgbouncer.get_auth` calls per invocation in pg_stat_statements.
    //
    // 60s outlives the in-run gaps while staying far below the interval
    // between two cron runs, so nothing is held across invocations.
    idleTimeoutMillis: 60_000,
  })

const adapter = new PrismaPg(pool)

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

// Cached in every environment, production included: whatever re-evaluates this
// module -- dev hot reload, or a second route bundle on the same warm serverless
// instance -- must reuse the pool rather than open a second one.
globalForPrisma.prisma = prisma
globalForPrisma.pool = pool
