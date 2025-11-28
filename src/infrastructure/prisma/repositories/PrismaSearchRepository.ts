import { PrismaClient } from '@prisma/client'
import { ISearchRepository } from '@/domain/repositories/ISearchRepository'
import { Search } from '@/domain/entities/Search'

export class PrismaSearchRepository implements ISearchRepository {
  constructor(private prisma: PrismaClient) {}

  async save(search: Search): Promise<Search> {
    const data = {
      name: search.name,
      url: search.url,
      isActive: search.isActive,
    }

    const created = await this.prisma.search.create({ data })
    return this.toDomain(created)
  }

  async findById(id: string): Promise<Search | null> {
    const search = await this.prisma.search.findUnique({ where: { id } })
    return search ? this.toDomain(search) : null
  }

  async findActive(): Promise<Search[]> {
    const searches = await this.prisma.search.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    })
    return searches.map((s) => this.toDomain(s))
  }

  async findAll(): Promise<Search[]> {
    const searches = await this.prisma.search.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return searches.map((s) => this.toDomain(s))
  }

  async update(search: Search): Promise<Search> {
    const updated = await this.prisma.search.update({
      where: { id: search.id },
      data: {
        name: search.name,
        url: search.url,
        isActive: search.isActive,
        updatedAt: new Date(),
      },
    })
    return this.toDomain(updated)
  }

  async delete(id: string): Promise<void> {
    await this.prisma.search.delete({ where: { id } })
  }

  private toDomain(raw: any): Search {
    return Search.fromPersistence({
      id: raw.id,
      name: raw.name,
      url: raw.url,
      isActive: raw.isActive,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    })
  }
}

