import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { TAXONOMY } from './taxonomy'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Starting database seed...')

  const searchSeeds = [
    {
      name: 'Table basse laiton',
      url: 'https://www.leboncoin.fr/recherche?text=Table+basse+laiton',
      isActive: true,
    },
    {
      name: 'Table basse laiton ',
      url: 'https://www.leboncoin.fr/recherche?text=Table+basse+laiton+',
      isActive: true,
    },
    {
      name: 'Desserte laiton doré',
      url: 'https://www.leboncoin.fr/recherche?text=Desserte+laiton+dor%C3%A9',
      isActive: true,
    },
    {
      name: 'Art deco',
      url: 'https://www.leboncoin.fr/recherche?text=Art+deco',
      isActive: true,
    },
    {
      name: 'Maison Jansen',
      url: 'https://www.leboncoin.fr/recherche?text=Maison+Jansen',
      isActive: true,
    },
    {
      name: 'Maison Charles',
      url: 'https://www.leboncoin.fr/recherche?text=Maison+Charles',
      isActive: true,
    },
    {
      name: 'Maison Bagues',
      url: 'https://www.leboncoin.fr/recherche?text=Maison+Bagues',
      isActive: true,
    },
    {
      name: "Table d'appoint",
      url: 'https://www.leboncoin.fr/recherche?text=Table+d%27appoint',
      isActive: true,
    },
    {
      name: 'Console vintage',
      url: 'https://www.leboncoin.fr/recherche?text=Console+vintage',
      isActive: true,
    },
    {
      name: 'Buffet laque',
      url: 'https://www.leboncoin.fr/recherche?text=Buffet+laque',
      isActive: true,
    },
    {
      name: 'Commode laque',
      url: 'https://www.leboncoin.fr/recherche?text=Commode+laque',
      isActive: true,
    },
    {
      name: 'Hollywood Regency',
      url: 'https://www.leboncoin.fr/recherche?text=Hollywood+Regency',
      isActive: true,
    },
    {
      name: 'Table basse 1970',
      url: 'https://www.leboncoin.fr/recherche?text=Table+basse+1970',
      isActive: true,
    },
    {
      name: 'Verre laiton',
      url: 'https://www.leboncoin.fr/recherche?text=Verre+laiton',
      isActive: true,
    },
    {
      name: 'Table basse vintage',
      url: 'https://www.leboncoin.fr/recherche?text=Table+basse+vintage',
      isActive: true,
    },
    {
      name: 'Suspension',
      url: 'https://www.leboncoin.fr/recherche?text=Suspension',
      isActive: true,
    },
    {
      name: '1970 meuble',
      url: 'https://www.leboncoin.fr/recherche?text=1970+meuble',
      isActive: true,
    },
    {
      name: '1970 lampe',
      url: 'https://www.leboncoin.fr/recherche?text=1970+lampe',
      isActive: true,
    },
  ]

  let createdSearches = 0
  let updatedSearches = 0

  for (const search of searchSeeds) {
    const existing = await prisma.search.findFirst({
      where: { url: search.url },
    })

    if (existing) {
      await prisma.search.update({
        where: { id: existing.id },
        data: {
          name: search.name,
          isActive: search.isActive,
        },
      })
      updatedSearches++
      continue
    }

    await prisma.search.create({ data: search })
    createdSearches++
  }

  console.log('✅ Search seed completed!')
  console.log(`Created ${createdSearches}, updated ${updatedSearches}`)

  console.log('🌱 Starting ProductSource seed...')
  const sources = [
    { 
      name: 'Pamono', 
      baseUrl: 'https://www.pamono.fr/',
      startUrl: 'https://www.pamono.fr/nouveautes',
    },
    {
      name: '1stdibs',
      baseUrl: 'https://www.1stdibs.com/',
      startUrl: 'https://www.1stdibs.com/fr/new-arrivals',
    }
  ]

  for (const source of sources) {
    await prisma.referenceSiteSource.upsert({
      where: { name: source.name },
      update: { 
        baseUrl: source.baseUrl,
        startUrl: source.startUrl,
      },
      create: source,
    })
  }
  console.log(`✅ ProductSource seed completed! Processed ${sources.length} sources.`)

  console.log('🌱 Starting Taxonomy seed...')
  
  let createdCategories = 0
  let createdPeriods = 0
  let createdMaterials = 0
  let createdStyles = 0

  for (let i = 0; i < TAXONOMY.CATEGORIES.length; i++) {
    const value = TAXONOMY.CATEGORIES[i]
    await prisma.taxonomyCategory.upsert({
      where: { value },
      update: { order: i, isActive: true },
      create: { value, order: i },
    })
    createdCategories++
  }

  for (let i = 0; i < TAXONOMY.PERIODS.length; i++) {
    const value = TAXONOMY.PERIODS[i]
    await prisma.taxonomyPeriod.upsert({
      where: { value },
      update: { order: i, isActive: true },
      create: { value, order: i },
    })
    createdPeriods++
  }

  for (let i = 0; i < TAXONOMY.MATERIALS.length; i++) {
    const value = TAXONOMY.MATERIALS[i]
    await prisma.taxonomyMaterial.upsert({
      where: { value },
      update: { order: i, isActive: true },
      create: { value, order: i },
    })
    createdMaterials++
  }

  for (let i = 0; i < TAXONOMY.STYLES.length; i++) {
    const value = TAXONOMY.STYLES[i]
    await prisma.taxonomyStyle.upsert({
      where: { value },
      update: { order: i, isActive: true },
      create: { value, order: i },
    })
    createdStyles++
  }

  console.log(`✅ Taxonomy seed completed!`)
  console.log(`  - Categories: ${createdCategories}`)
  console.log(`  - Periods: ${createdPeriods}`)
  console.log(`  - Materials: ${createdMaterials}`)
  console.log(`  - Styles: ${createdStyles}`)
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

