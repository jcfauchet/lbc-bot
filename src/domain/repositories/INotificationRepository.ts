import { Notification, NotificationStatus } from '../entities/Notification'

export interface INotificationRepository {
  save(notification: Notification): Promise<Notification>
  findById(id: string): Promise<Notification | null>
  findByListingId(listingId: string): Promise<Notification[]>
  findByStatus(status: NotificationStatus): Promise<Notification[]>
  update(notification: Notification): Promise<Notification>
  delete(id: string): Promise<void>
}

