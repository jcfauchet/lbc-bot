import { PrismaClient } from '@prisma/client'
import { ITaxonomyRepository } from '@/domain/repositories/ITaxonomyRepository'

export class PrismaTaxonomyRepository implements ITaxonomyRepository {
  constructor(private prisma: PrismaClient) {}

  async getCategories(): Promise<string[]> {
    const items = await this.prisma.taxonomyCategory.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
    return items.map((item) => item.value)
  }

  async getPeriods(): Promise<string[]> {
    const items = await this.prisma.taxonomyPeriod.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
    return items.map((item) => item.value)
  }

  async getMaterials(): Promise<string[]> {
    const items = await this.prisma.taxonomyMaterial.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
    return items.map((item) => item.value)
  }

  async getStyles(): Promise<string[]> {
    const items = await this.prisma.taxonomyStyle.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
    return items.map((item) => item.value)
  }
}

