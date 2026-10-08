export interface ListingImageProps {
  id: string
  listingId: string
  urlRemote: string
  /** 0 is the ad's cover; the rest follow the ad's own order. */
  position: number
  pathLocal?: string
  createdAt: Date
}

export class ListingImage {
  private constructor(private props: ListingImageProps) {}

  static create(
    props: Omit<ListingImageProps, 'id' | 'createdAt'>
  ): ListingImage {
    return new ListingImage({
      ...props,
      id: '',
      createdAt: new Date(),
    })
  }

  static fromPersistence(props: ListingImageProps): ListingImage {
    return new ListingImage(props)
  }

  get id(): string {
    return this.props.id
  }

  get listingId(): string {
    return this.props.listingId
  }

  get urlRemote(): string {
    return this.props.urlRemote
  }

  get position(): number {
    return this.props.position
  }

  get pathLocal(): string | undefined {
    return this.props.pathLocal
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  setLocalPath(path: string | undefined): void {
    this.props.pathLocal = path
  }

  isDownloaded(): boolean {
    return !!this.props.pathLocal
  }
}

