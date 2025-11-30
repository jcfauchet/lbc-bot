export interface ITaxonomyRepository {
  getCategories(): Promise<string[]>
}

