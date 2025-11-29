import 'dotenv/config'
import { defineConfig } from 'prisma/config'

const directUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL!,
    ...(directUrl && { directUrl }),
  },
})

