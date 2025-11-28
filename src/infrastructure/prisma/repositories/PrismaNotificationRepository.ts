import { PrismaClient } from '@prisma/client'
import { INotificationRepository } from '@/domain/repositories/INotificationRepository'
import { Notification, NotificationChannel, NotificationStatus } from '@/domain/entities/Notification'

export class PrismaNotificationRepository implements INotificationRepository {
  constructor(private prisma: PrismaClient) {}

  async save(notification: Notification): Promise<Notification> {
    const data = {
      listingId: notification.listingId,
      channel: notification.channel,
      status: notification.status,
      sentAt: notification.sentAt,
      error: notification.error,
    }

    const created = await this.prisma.notification.create({ data })
    return this.toDomain(created)
  }

  async findById(id: string): Promise<Notification | null> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    })
    return notification ? this.toDomain(notification) : null
  }

  async findByListingId(listingId: string): Promise<Notification[]> {
    const notifications = await this.prisma.notification.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
    })
    return notifications.map((n) => this.toDomain(n))
  }

  async findByStatus(status: NotificationStatus): Promise<Notification[]> {
    const notifications = await this.prisma.notification.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    })
    return notifications.map((n) => this.toDomain(n))
  }

  async update(notification: Notification): Promise<Notification> {
    const updated = await this.prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: notification.status,
        sentAt: notification.sentAt,
        error: notification.error,
      },
    })
    return this.toDomain(updated)
  }

  async delete(id: string): Promise<void> {
    await this.prisma.notification.delete({ where: { id } })
  }

  private toDomain(raw: any): Notification {
    return Notification.fromPersistence({
      id: raw.id,
      listingId: raw.listingId,
      channel: raw.channel as NotificationChannel,
      status: raw.status as NotificationStatus,
      sentAt: raw.sentAt,
      error: raw.error,
      createdAt: raw.createdAt,
    })
  }
}

