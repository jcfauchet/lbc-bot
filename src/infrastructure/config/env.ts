import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1),
  GOOGLE_GEMINI_API_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  NOTIFICATION_EMAIL_FROM: z.string().email(),
  NOTIFICATION_EMAIL_TO: z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim()))
    .pipe(z.array(z.string().email())),
  CRON_SECRET: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  MIN_MARGIN_IN_EUR: z.coerce.number().min(50).default(100),
  MIN_LISTING_PRICE_EUR: z.coerce.number().min(0).default(50),
  MAX_LISTING_PRICE_EUR: z.coerce.number().min(0).default(700),
  AI_PROVIDER: z.enum(['openai', 'gemini']).default('openai'),
  SEARCH_TERM_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
  PROXY_ENABLED: z.coerce.boolean().default(false),
  PROXY_LIST: z
    .string()
    .optional()
    .transform((v) => v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.format())
    throw new Error('Invalid environment variables')
  }

  return parsed.data
}

export const env = loadEnv()

