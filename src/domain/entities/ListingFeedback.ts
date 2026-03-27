export interface ListingFeedbackProps {
  id?: string
  listingId: string
  isGood: boolean
  comment?: string
  embeddingText?: string
  createdAt?: Date
}

export class ListingFeedback {
  readonly id: string
  readonly listingId: string
  readonly isGood: boolean
  readonly comment?: string
  readonly embeddingText?: string
  readonly createdAt: Date

  private constructor(props: ListingFeedbackProps) {
    this.id = props.id ?? crypto.randomUUID()
    this.listingId = props.listingId
    this.isGood = props.isGood
    this.comment = props.comment
    this.embeddingText = props.embeddingText
    this.createdAt = props.createdAt ?? new Date()
  }

  static create(props: ListingFeedbackProps): ListingFeedback {
    return new ListingFeedback(props)
  }
}
