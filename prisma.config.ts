import 'dotenv/config'
import { defineConfig } from 'prisma/config'


export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL as string,
    shadowDatabaseUrl: 'postgresql://postgres.xjytxesfwspjnqzgerlz:Yutw1uYx7U8gAE18@aws-1-eu-west-3.pooler.supabase.com:6543/postgres?sslmode=require',
  },
})

