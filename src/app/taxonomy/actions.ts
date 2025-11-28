'use server'

import { prisma } from '@/infrastructure/prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const taxonomySchema = z.object({
  value: z.string().min(1, 'Value is required'),
  order: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

type TaxonomyType = 'category' | 'period' | 'material' | 'style'

export async function getTaxonomies(type: TaxonomyType) {
  switch (type) {
    case 'category':
      return prisma.taxonomyCategory.findMany({
        orderBy: { order: 'asc' },
      })
    case 'period':
      return prisma.taxonomyPeriod.findMany({
        orderBy: { order: 'asc' },
      })
    case 'material':
      return prisma.taxonomyMaterial.findMany({
        orderBy: { order: 'asc' },
      })
    case 'style':
      return prisma.taxonomyStyle.findMany({
        orderBy: { order: 'asc' },
      })
  }
}

export async function createTaxonomy(
  type: TaxonomyType,
  formData: FormData
) {
  const rawData = {
    value: formData.get('value'),
    order: formData.get('order') ? Number(formData.get('order')) : 0,
    isActive: formData.get('isActive') === 'true',
  }

  const validatedData = taxonomySchema.parse(rawData)

  switch (type) {
    case 'category':
      await prisma.taxonomyCategory.create({ data: validatedData })
      break
    case 'period':
      await prisma.taxonomyPeriod.create({ data: validatedData })
      break
    case 'material':
      await prisma.taxonomyMaterial.create({ data: validatedData })
      break
    case 'style':
      await prisma.taxonomyStyle.create({ data: validatedData })
      break
  }

  revalidatePath('/taxonomy')
}

export async function updateTaxonomy(
  type: TaxonomyType,
  id: string,
  formData: FormData
) {
  const rawData = {
    value: formData.get('value'),
    order: formData.get('order') ? Number(formData.get('order')) : 0,
    isActive: formData.get('isActive') === 'true',
  }

  const validatedData = taxonomySchema.parse(rawData)

  switch (type) {
    case 'category':
      await prisma.taxonomyCategory.update({
        where: { id },
        data: validatedData,
      })
      break
    case 'period':
      await prisma.taxonomyPeriod.update({
        where: { id },
        data: validatedData,
      })
      break
    case 'material':
      await prisma.taxonomyMaterial.update({
        where: { id },
        data: validatedData,
      })
      break
    case 'style':
      await prisma.taxonomyStyle.update({
        where: { id },
        data: validatedData,
      })
      break
  }

  revalidatePath('/taxonomy')
}

export async function deleteTaxonomy(type: TaxonomyType, id: string) {
  switch (type) {
    case 'category':
      await prisma.taxonomyCategory.delete({ where: { id } })
      break
    case 'period':
      await prisma.taxonomyPeriod.delete({ where: { id } })
      break
    case 'material':
      await prisma.taxonomyMaterial.delete({ where: { id } })
      break
    case 'style':
      await prisma.taxonomyStyle.delete({ where: { id } })
      break
  }

  revalidatePath('/taxonomy')
}

export async function toggleTaxonomyStatus(type: TaxonomyType, id: string) {
  let item: { isActive: boolean } | null = null

  switch (type) {
    case 'category':
      item = await prisma.taxonomyCategory.findUnique({ where: { id } })
      if (item) {
        await prisma.taxonomyCategory.update({
          where: { id },
          data: { isActive: !item.isActive },
        })
      }
      break
    case 'period':
      item = await prisma.taxonomyPeriod.findUnique({ where: { id } })
      if (item) {
        await prisma.taxonomyPeriod.update({
          where: { id },
          data: { isActive: !item.isActive },
        })
      }
      break
    case 'material':
      item = await prisma.taxonomyMaterial.findUnique({ where: { id } })
      if (item) {
        await prisma.taxonomyMaterial.update({
          where: { id },
          data: { isActive: !item.isActive },
        })
      }
      break
    case 'style':
      item = await prisma.taxonomyStyle.findUnique({ where: { id } })
      if (item) {
        await prisma.taxonomyStyle.update({
          where: { id },
          data: { isActive: !item.isActive },
        })
      }
      break
  }

  if (!item) {
    throw new Error('Taxonomy item not found')
  }

  revalidatePath('/taxonomy')
}

