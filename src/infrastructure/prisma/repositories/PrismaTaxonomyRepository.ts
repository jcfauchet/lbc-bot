import { PrismaClient } from '@prisma/client'
import { ITaxonomyRepository } from '@/domain/repositories/ITaxonomyRepository'

export class PrismaTaxonomyRepository implements ITaxonomyRepository {
  constructor(private prisma: PrismaClient) {}

  async getCategories(): Promise<string[]> {
    const items = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
    return items.map((item) => item.value)
  }
}

