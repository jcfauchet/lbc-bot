import { getSearches } from './actions'
import { SearchForm } from './SearchForm'
import { SearchList } from './SearchList'

export const dynamic = 'force-dynamic'

export default async function SearchesPage() {
  const searches = await getSearches()

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <div className="mb-8 flex justify-between items-center">
        <h1 className="text-3xl m-0">Manage Searches</h1>
        <a href="/" className="text-blue-600 no-underline hover:underline">
          &larr; Back to Home
        </a>
      </div>

      <SearchForm />
      
      <h2 className="mb-4">Your Searches</h2>
      <SearchList searches={searches} />
    </main>
  )
}
