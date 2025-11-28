export interface ListingLabelProps {
  id: string
  listingId: string
  label: string
  comment?: string
  createdAt: Date
}

export class ListingLabel {
  private constructor(private props: ListingLabelProps) {}

  static create(
    props: Omit<ListingLabelProps, 'id' | 'createdAt'>
  ): ListingLabel {
    return new ListingLabel({
      ...props,
      id: '',
      createdAt: new Date(),
    })
  }

  static fromPersistence(props: ListingLabelProps): ListingLabel {
    return new ListingLabel(props)
  }

  get id(): string {
    return this.props.id
  }

  get listingId(): string {
    return this.props.listingId
  }

  get label(): string {
    return this.props.label
  }

  get comment(): string | undefined {
    return this.props.comment
  }

  get createdAt(): Date {
    return this.props.createdAt
  }
}

