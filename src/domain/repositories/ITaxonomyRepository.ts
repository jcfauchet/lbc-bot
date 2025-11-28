export interface ITaxonomyRepository {
  getCategories(): Promise<string[]>
  getPeriods(): Promise<string[]>
  getMaterials(): Promise<string[]>
  getStyles(): Promise<string[]>
}

