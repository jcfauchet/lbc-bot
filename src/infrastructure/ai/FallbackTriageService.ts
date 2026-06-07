import type { ITriageService, TriageResult } from '@/domain/services/ITriageService'

export class FallbackTriageService implements ITriageService {
  readonly providerName: string

  constructor(
    private readonly primary: ITriageService,
    private readonly fallback: ITriageService,
  ) {
    this.providerName = `${primary.providerName}+${fallback.providerName}`
  }

  async triage(imageUrl: string, title: string, guidance?: string | null): Promise<TriageResult> {
    try {
      return await this.primary.triage(imageUrl, title, guidance)
    } catch (err) {
      console.warn(`Triage primary (${this.primary.providerName}) failed, falling back:`, err)
      return this.fallback.triage(imageUrl, title, guidance)
    }
  }
}
