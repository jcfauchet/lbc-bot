import { Search } from '../entities/Search'

export interface ISearchRepository {
  save(search: Search): Promise<Search>
  findById(id: string): Promise<Search | null>
  findActive(): Promise<Search[]>
  findAll(): Promise<Search[]>
  update(search: Search): Promise<Search>
  delete(id: string): Promise<void>
}

