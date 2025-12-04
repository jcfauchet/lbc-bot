import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

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

  console.log('🌱 Starting Category seed...')
  
  let createdCategories = 0

  const CATEGORIES = [
    'table_basse',
    'table_repas',
    'chaise',
    'fauteuil',
    'canapé',
    'table',
    'enfilade',
    'commode',
    'bibliothèque',
    'buffet',
    'bureau',
    'lampe_de_table',
    'lampe',
    'lampadaire',
    'suspension',
    'applique',
    'miroir',
    'objet_déco',
    'plateau',
    'étagère',
    'guéridon',
    'pouf',
    'étagère',
    'table de chevet'
  ]

  for (let i = 0; i < CATEGORIES.length; i++) {
    const value = CATEGORIES[i]
    await prisma.category.upsert({
      where: { value },
      update: { order: i, isActive: true },
      create: { value, order: i },
    })
    createdCategories++
  }

  console.log(`✅ Category seed completed!`)
  console.log(`  - Categories: ${createdCategories}`)
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

