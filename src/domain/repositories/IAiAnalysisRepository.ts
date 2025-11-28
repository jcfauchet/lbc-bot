import { AiAnalysis } from '../entities/AiAnalysis'

export interface IAiAnalysisRepository {
  save(analysis: AiAnalysis): Promise<AiAnalysis>
  findById(id: string): Promise<AiAnalysis | null>
  findByListingId(listingId: string): Promise<AiAnalysis | null>
  findByMinMargin(minMargin: number): Promise<AiAnalysis[]>
  findAll(): Promise<AiAnalysis[]>
  update(analysis: AiAnalysis): Promise<AiAnalysis>
  delete(id: string): Promise<void>
}

