import { Money } from '../value-objects/Money'
import { ListingStatus } from '../value-objects/ListingStatus'

export interface ListingProps {
  id: string
  lbcId: string
  searchId: string
  url: string
  title: string
  price: Money
  city?: string
  region?: string
  publishedAt?: Date
  status: ListingStatus
  createdAt: Date
  updatedAt: Date
}

export class Listing {
  private constructor(private props: ListingProps) {}

  static create(props: Omit<ListingProps, 'id' | 'createdAt' | 'updatedAt'>): Listing {
    return new Listing({
      ...props,
      id: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static fromPersistence(props: ListingProps): Listing {
    return new Listing(props)
  }

  get id(): string {
    return this.props.id
  }

  get lbcId(): string {
    return this.props.lbcId
  }

  get searchId(): string {
    return this.props.searchId
  }

  get url(): string {
    return this.props.url
  }

  get title(): string {
    return this.props.title
  }

  get price(): Money {
    return this.props.price
  }

  get city(): string | undefined {
    return this.props.city
  }

  get region(): string | undefined {
    return this.props.region
  }

  get publishedAt(): Date | undefined {
    return this.props.publishedAt
  }

  get status(): ListingStatus {
    return this.props.status
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get updatedAt(): Date {
    return this.props.updatedAt
  }

  markAsAnalyzed(): void {
    this.props.status = ListingStatus.ANALYZED
    this.props.updatedAt = new Date()
  }

  markAsNotified(): void {
    this.props.status = ListingStatus.NOTIFIED
    this.props.updatedAt = new Date()
  }

  markAsArchived(): void {
    this.props.status = ListingStatus.ARCHIVED
    this.props.updatedAt = new Date()
  }

  markAsIgnored(): void {
    this.props.status = ListingStatus.IGNORED
    this.props.updatedAt = new Date()
  }
}

