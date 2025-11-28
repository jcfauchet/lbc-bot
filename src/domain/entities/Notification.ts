export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  WEBHOOK = 'webhook',
}

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
}

export interface NotificationProps {
  id: string
  listingId: string
  channel: NotificationChannel
  status: NotificationStatus
  sentAt?: Date
  error?: string
  createdAt: Date
}

export class Notification {
  private constructor(private props: NotificationProps) {}

  static create(
    props: Omit<NotificationProps, 'id' | 'createdAt' | 'status'>
  ): Notification {
    return new Notification({
      ...props,
      id: '',
      status: NotificationStatus.PENDING,
      createdAt: new Date(),
    })
  }

  static fromPersistence(props: NotificationProps): Notification {
    return new Notification(props)
  }

  get id(): string {
    return this.props.id
  }

  get listingId(): string {
    return this.props.listingId
  }

  get channel(): NotificationChannel {
    return this.props.channel
  }

  get status(): NotificationStatus {
    return this.props.status
  }

  get sentAt(): Date | undefined {
    return this.props.sentAt
  }

  get error(): string | undefined {
    return this.props.error
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  markAsSent(): void {
    this.props.status = NotificationStatus.SENT
    this.props.sentAt = new Date()
  }

  markAsFailed(error: string): void {
    this.props.status = NotificationStatus.FAILED
    this.props.error = error
  }
}

