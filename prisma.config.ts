import 'dotenv/config'
import { defineConfig } from 'prisma/config'


export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: 'postgresql://postgres.xjytxesfwspjnqzgerlz:Yutw1uYx7U8gAE18@aws-1-eu-west-3.pooler.supabase.com:6543/postgres',
    // shadowDatabaseUrl: 'postgresql://postgres:Yutw1uYx7U8gAE18@db.xjytxesfwspjnqzgerlz.supabase.co:5432/postgres?sslmode=require',
  },
})

