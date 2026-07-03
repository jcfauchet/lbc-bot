import type { ITriageService, TriageInput, TriageResult } from '@/domain/services/ITriageService'

export class FallbackTriageService implements ITriageService {
  readonly providerName: string

  constructor(
    private readonly primary: ITriageService,
    private readonly fallback: ITriageService,
  ) {
    this.providerName = `${primary.providerName}+${fallback.providerName}`
  }

  async triage(input: TriageInput, guidance?: string | null): Promise<TriageResult> {
    try {
      return await this.primary.triage(input, guidance)
    } catch (err) {
      console.warn(`Triage primary (${this.primary.providerName}) failed, falling back:`, err)
      return this.fallback.triage(input, guidance)
    }
  }
}
