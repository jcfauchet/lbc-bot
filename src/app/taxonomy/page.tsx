import { getTaxonomies } from './actions'
import { TaxonomyForm } from './TaxonomyForm'
import { TaxonomyList } from './TaxonomyList'
import { TaxonomyManager } from './TaxonomyManager'

export default async function TaxonomyPage() {
  const [categories, periods, materials, styles] = await Promise.all([
    getTaxonomies('category'),
    getTaxonomies('period'),
    getTaxonomies('material'),
    getTaxonomies('style'),
  ])

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <div className="mb-8 flex justify-between items-center">
        <h1 className="text-3xl m-0">Manage Taxonomy</h1>
        <a href="/" className="text-blue-600 no-underline hover:underline">
          &larr; Back to Home
        </a>
      </div>

      <TaxonomyManager
        categories={categories}
        periods={periods}
        materials={materials}
        styles={styles}
      />
    </main>
  )
}

