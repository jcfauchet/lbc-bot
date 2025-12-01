import { Money } from '../value-objects/Money'
import { SearchTerm } from '../services/IPriceEstimationService'

export interface AiAnalysisProps {
  id: string
  listingId: string
  estimatedMinPrice: Money
  estimatedMaxPrice: Money
  margin: Money
  description: string
  confidence?: number
  provider: string
  bestMatchSource?: string
  searchTerms?: SearchTerm[]
  createdAt: Date
  updatedAt: Date
}

export class AiAnalysis {
  private constructor(private props: AiAnalysisProps) {}

  static create(props: {
    listingId: string
    estimatedMinPrice: Money
    estimatedMaxPrice: Money
    margin: Money
    description: string
    confidence?: number
    provider: string
    bestMatchSource?: string
    searchTerms?: SearchTerm[]
  }): AiAnalysis {
    return new AiAnalysis({
      id: crypto.randomUUID(),
      ...props,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static fromPersistence(props: AiAnalysisProps): AiAnalysis {
    return new AiAnalysis(props)
  }

  get id(): string {
    return this.props.id
  }

  get listingId(): string {
    return this.props.listingId
  }

  get estimatedMinPrice(): Money {
    return this.props.estimatedMinPrice
  }

  get estimatedMaxPrice(): Money {
    return this.props.estimatedMaxPrice
  }

  get margin(): Money {
    return this.props.margin
  }

  get description(): string {
    return this.props.description
  }

  get confidence(): number | undefined {
    return this.props.confidence
  }

  get provider(): string {
    return this.props.provider
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get updatedAt(): Date {
    return this.props.updatedAt
  }

  get bestMatchSource(): string | undefined {
    return this.props.bestMatchSource
  }

  get searchTerms(): SearchTerm[] | undefined {
    return this.props.searchTerms
  }
}

