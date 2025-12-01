import { IListingRepository } from '@/domain/repositories/IListingRepository'

export class RunCleanupUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private daysOld: number = 14
  ) {}

  async execute(): Promise<{ deleted: number }> {
    const deleted = await this.listingRepository.deleteIgnoredOlderThan(this.daysOld)
    
    return { deleted }
  }
}

