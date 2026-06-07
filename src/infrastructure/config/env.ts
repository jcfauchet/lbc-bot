import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
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
  LENS_DAILY_BUDGET: z.coerce.number().min(0).default(8),
  LENS_MONTHLY_BUDGET: z.coerce.number().min(0).default(250),
  TRIAGE_MIN_SCORE: z.coerce.number().min(0).max(10).default(5),
  TRIAGE_MAX_PER_RUN: z.coerce.number().min(1).default(25),
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
