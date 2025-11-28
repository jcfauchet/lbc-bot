'use server'

import { prisma } from '@/infrastructure/prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const searchSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  url: z.string().url('Invalid URL'),
})

export async function getSearches() {
  return prisma.search.findMany({
    orderBy: { createdAt: 'desc' },
  })
}

export async function createSearch(formData: FormData) {
  const rawData = {
    name: formData.get('name'),
    url: formData.get('url'),
  }

  const validatedData = searchSchema.parse(rawData)

  await prisma.search.create({
    data: validatedData,
  })

  revalidatePath('/searches')
}

export async function updateSearch(id: string, formData: FormData) {
  const rawData = {
    name: formData.get('name'),
    url: formData.get('url'),
  }

  const validatedData = searchSchema.parse(rawData)

  await prisma.search.update({
    where: { id },
    data: validatedData,
  })

  revalidatePath('/searches')
}

export async function deleteSearch(id: string) {
  await prisma.search.delete({
    where: { id },
  })

  revalidatePath('/searches')
}

export async function toggleSearchStatus(id: string) {
  const search = await prisma.search.findUnique({
    where: { id },
  })

  if (!search) {
    throw new Error('Search not found')
  }

  await prisma.search.update({
    where: { id },
    data: { isActive: !search.isActive },
  })

  revalidatePath('/searches')
}
