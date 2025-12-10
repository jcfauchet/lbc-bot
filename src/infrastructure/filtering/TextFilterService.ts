import { ITextFilterService } from '@/domain/services/ITextFilterService'
import { EXCLUDED_KEYWORDS } from '@/infrastructure/config/constants'

export class TextFilterService implements ITextFilterService {
  shouldExclude(title: string): { exclude: boolean; reason?: string } {
    const normalizedTitle = this.normalizeText(title)
    
    for (const keyword of EXCLUDED_KEYWORDS) {
      const normalizedKeyword = this.normalizeText(keyword)
      
      if (normalizedTitle.includes(normalizedKeyword)) {
        return {
          exclude: true,
          reason: `Titre contient le mot-clé exclu: "${keyword}"`
        }
      }
    }
    
    return { exclude: false }
  }
  
  private normalizeText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  }
}

