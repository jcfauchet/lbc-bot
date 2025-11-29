import { PrismaClient } from '@prisma/client'
import { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import { ListingImage } from '@/domain/entities/ListingImage'

export class PrismaLbcProductListingImageRepository implements IListingImageRepository {
  constructor(private prisma: PrismaClient) {}

  async save(image: ListingImage): Promise<ListingImage> {
    const data = {
      listingId: image.listingId,
      urlRemote: image.urlRemote,
      pathLocal: image.pathLocal,
    }

    const created = await this.prisma.listingImage.create({ data })
    return this.toDomain(created)
  }

  async findById(id: string): Promise<ListingImage | null> {
    const image = await this.prisma.listingImage.findUnique({ where: { id } })
    return image ? this.toDomain(image) : null
  }

  async findByListingId(listingId: string): Promise<ListingImage[]> {
    const images = await this.prisma.listingImage.findMany({
      where: { listingId },
      orderBy: { createdAt: 'asc' },
    })
    return images.map((i) => this.toDomain(i))
  }

  async findNotDownloaded(): Promise<ListingImage[]> {
    const images = await this.prisma.listingImage.findMany({
      where: { pathLocal: null },
      orderBy: { createdAt: 'asc' },
    })
    return images.map((i) => this.toDomain(i))
  }

  async update(image: ListingImage): Promise<ListingImage> {
    const updated = await this.prisma.listingImage.update({
      where: { id: image.id },
      data: {
        pathLocal: image.pathLocal,
      },
    })
    return this.toDomain(updated)
  }

  async delete(id: string): Promise<void> {
    await this.prisma.listingImage.delete({ where: { id } })
  }

  private toDomain(raw: any): ListingImage {
    return ListingImage.fromPersistence({
      id: raw.id,
      listingId: raw.listingId,
      urlRemote: raw.urlRemote,
      pathLocal: raw.pathLocal,
      createdAt: raw.createdAt,
    })
  }
}

