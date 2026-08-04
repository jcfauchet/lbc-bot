import 'dotenv/config'
import { z } from 'zod'

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  GOOGLE_GEMINI_API_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  NOTIFICATION_EMAIL_FROM: z.string().email().optional(),
  NOTIFICATION_EMAIL_TO: z
    .string()
    .optional()
    .transform((v) => v ? v.split(',').map((s) => s.trim()) : [])
    .pipe(z.array(z.string().email())),
  CRON_SECRET: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  MIN_MARGIN_IN_EUR: z.coerce.number().min(50).default(100),
  // Worst-case-still-profitable floor: emails require (estMin − price) ≥ this.
  // Lower than MIN_MARGIN_IN_EUR because it is measured at the low end of the
  // estimate band. 0 disables the gate.
  MIN_CONSERVATIVE_MARGIN_IN_EUR: z.coerce.number().min(0).default(60),
  MIN_LISTING_PRICE_EUR: z.coerce.number().min(0).default(50),
  MAX_LISTING_PRICE_EUR: z.coerce.number().min(0).default(700),
  AI_PROVIDER: z.enum(['openai', 'gemini', 'random']).default('openai'),
  SEARCH_TERM_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
  APP_URL: z.string().url().default('http://localhost:3000'),
  LBC_DATADOME_COOKIE: z.string().optional(),
  PROXY_ENABLED: z.coerce.boolean().default(false),
  PROXY_LIST: z
    .string()
    .optional()
    .transform((v) => v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []),
  SERPAPI_KEY: z.string().min(1).optional(),
  // 8/day ≈ 240/month, fits the 250 SerpAPI plan (the account ran dry on
  // 5 Jul 2026 at 8+2). Formerly 6 standard + 2 fast-track; the fast-track lane
  // was folded in when windowed accrual made queue-jumping pointless.
  LENS_DAILY_BUDGET: z.coerce.number().min(0).default(8),
  LENS_MONTHLY_BUDGET: z.coerce.number().min(0).default(250),
  // The day's comp budget accrues one share per window rather than being fully
  // available at midnight. 4 windows = 6h, so a fresh find waits 6h at worst.
  LENS_WINDOWS_PER_DAY: z.coerce.number().int().min(1).default(4),
  // Candidates submitted to the comparative ranker per window. Absolute triage
  // scoring saturates (967 of 1651 qualified listings scored exactly 9 over the
  // two weeks to 2 Aug 2026), so the ranker, not the score, picks the winners.
  RANKING_SHORTLIST_SIZE: z.coerce.number().min(1).default(20),
  // Kill switch for the ranker call only: the windowed budget still applies and
  // candidates are served in the deterministic score-then-freshness order.
  // Explicit enum, not z.coerce.boolean() — that coerces any non-empty string
  // (including the literal "false") to true, silently defeating the switch.
  RANKING_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Dealer asking prices (comps) -> realistic quick-resale value.
  RESALE_REALIZATION_FACTOR: z.coerce.number().min(0.1).max(1).default(0.6),
  // Offline eval (Jul 2026, 150 labelled listings): precision is flat (~33%)
  // across thresholds 4-8, so the threshold is a volume knob, not a precision
  // knob. 6 trims queue pressure while keeping 84% recall.
  TRIAGE_MIN_SCORE: z.coerce.number().min(0).max(10).default(6),
  TRIAGE_MAX_PER_RUN: z.coerce.number().min(1).default(25),
  FEEDBACK_LEARNING_MAX_ITEMS: z.coerce.number().min(1).default(200),
  // Above this cosine similarity, a candidate is treated as a near-duplicate of a
  // piece the user already rejected and skipped before spending a comp credit.
  SIMILAR_FEEDBACK_SKIP_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  // TRIAGED listings older than this are expired before comp: the deal is gone
  // and a comp credit spent on them is wasted.
  TRIAGED_MAX_AGE_DAYS: z.coerce.number().min(1).default(7),
  // A listing whose Lens search returns at least this many mass-market retail
  // matches (outnumbering value comps) is dropped as a common new product. 0
  // disables the check.
  MASS_MARKET_MIN_MATCHES: z.coerce.number().min(0).default(4),
})

export type Env = z.infer<typeof envSchema>

export function requireEnv(name: keyof Env): string {
  const value = env[name]
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(`Missing required environment variable: ${name}`)
}

export function requireEnvList(name: keyof Env): string[] {
  const value = env[name]
  if (Array.isArray(value) && value.length > 0) return value
  throw new Error(`Missing required environment variable: ${name}`)
}

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.format())
    throw new Error('Invalid environment variables')
  }

  return parsed.data
}

export const env = loadEnv()
