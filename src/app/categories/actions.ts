'use server'

import { prisma } from '@/infrastructure/prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const categorySchema = z.object({
  value: z.string().min(1, 'Value is required'),
  order: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

export async function getCategories() {
  return prisma.category.findMany({
    orderBy: { order: 'asc' },
  })
}

export async function createCategory(formData: FormData) {
  const rawData = {
    value: formData.get('value'),
    order: formData.get('order') ? Number(formData.get('order')) : 0,
    isActive: formData.get('isActive') === 'true',
  }

  const validatedData = categorySchema.parse(rawData)

  await prisma.category.create({ data: validatedData })

  revalidatePath('/categories')
}

export async function updateCategory(id: string, formData: FormData) {
  const rawData = {
    value: formData.get('value'),
    order: formData.get('order') ? Number(formData.get('order')) : 0,
    isActive: formData.get('isActive') === 'true',
  }

  const validatedData = categorySchema.parse(rawData)

  await prisma.category.update({
    where: { id },
    data: validatedData,
  })

  revalidatePath('/categories')
}

export async function deleteCategory(id: string) {
  await prisma.category.delete({ where: { id } })

  revalidatePath('/categories')
}

export async function toggleCategoryStatus(id: string) {
  const item = await prisma.category.findUnique({ where: { id } })

  if (!item) {
    throw new Error('Category not found')
  }

  await prisma.category.update({
    where: { id },
    data: { isActive: !item.isActive },
  })

  revalidatePath('/categories')
}

