export interface SearchProps {
  id: string
  name: string
  url: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export class Search {
  private constructor(private props: SearchProps) {}

  static create(props: Omit<SearchProps, 'id' | 'createdAt' | 'updatedAt'>): Search {
    return new Search({
      ...props,
      id: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static fromPersistence(props: SearchProps): Search {
    return new Search(props)
  }

  get id(): string {
    return this.props.id
  }

  get name(): string {
    return this.props.name
  }

  get url(): string {
    return this.props.url
  }

  get isActive(): boolean {
    return this.props.isActive
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get updatedAt(): Date {
    return this.props.updatedAt
  }

  activate(): void {
    this.props.isActive = true
    this.props.updatedAt = new Date()
  }

  deactivate(): void {
    this.props.isActive = false
    this.props.updatedAt = new Date()
  }
}

