import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function clearTable(model: any, name: string) {
  try {
    await model.deleteMany()
    console.log(`  ✓ Cleared ${name}`)
  } catch (error: any) {
    if (error.code === 'P2021') {
      console.log(`  ⚠ ${name} table does not exist yet (skipping)`)
    } else {
      throw error
    }
  }
}

async function main() {
  console.log('🗑️  Clearing all database data...')

 
  await clearTable(prisma.listingLabel, 'ListingLabel')
  await clearTable(prisma.notification, 'Notification')
  await clearTable(prisma.aiAnalysis, 'AiAnalysis')
  await clearTable(prisma.listingImage, 'ListingImage')
  await clearTable(prisma.lbcProductListing, 'LbcProductListing')
  await clearTable(prisma.search, 'Search')

  console.log('✅ Database cleared!')
}

main()
  .catch((e) => {
    console.error('❌ Clear failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

