import { PrismaClient } from '@prisma/client'
import { IListingLabelRepository } from '@/domain/repositories/IListingLabelRepository'
import { ListingLabel } from '@/domain/entities/ListingLabel'

export class PrismaListingLabelRepository implements IListingLabelRepository {
  constructor(private prisma: PrismaClient) {}

  async save(label: ListingLabel): Promise<ListingLabel> {
    const data = {
      listingId: label.listingId,
      label: label.label,
      comment: label.comment,
    }

    const created = await this.prisma.listingLabel.create({ data })
    return this.toDomain(created)
  }

  async findById(id: string): Promise<ListingLabel | null> {
    const label = await this.prisma.listingLabel.findUnique({ where: { id } })
    return label ? this.toDomain(label) : null
  }

  async findByListingId(listingId: string): Promise<ListingLabel[]> {
    const labels = await this.prisma.listingLabel.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
    })
    return labels.map((l) => this.toDomain(l))
  }

  async findByLabel(label: string): Promise<ListingLabel[]> {
    const labels = await this.prisma.listingLabel.findMany({
      where: { label },
      orderBy: { createdAt: 'desc' },
    })
    return labels.map((l) => this.toDomain(l))
  }

  async delete(id: string): Promise<void> {
    await this.prisma.listingLabel.delete({ where: { id } })
  }

  private toDomain(raw: any): ListingLabel {
    return ListingLabel.fromPersistence({
      id: raw.id,
      listingId: raw.listingId,
      label: raw.label,
      comment: raw.comment,
      createdAt: raw.createdAt,
    })
  }
}

