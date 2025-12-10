export interface ITextFilterService {
  shouldExclude(title: string): { exclude: boolean; reason?: string }
}

