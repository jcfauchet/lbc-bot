'use client'

import { useRouter } from 'next/navigation'
import { deleteCategory, toggleCategoryStatus } from './actions'

type CategoryItem = {
  id: string
  value: string
  order: number
  isActive: boolean
}

interface CategoryListProps {
  items: CategoryItem[]
  onEdit: (item: CategoryItem) => void
}

export function TaxonomyList({ items, onEdit }: CategoryListProps) {
  const router = useRouter()

  const handleDelete = async (id: string, value: string) => {
    if (confirm(`Are you sure you want to delete "${value}"?`)) {
      await deleteCategory(id)
      router.refresh()
    }
  }

  const handleToggle = async (id: string) => {
    await toggleCategoryStatus(id)
    router.refresh()
  }

  return (
    <div className="mb-8">
      <h3 className="text-xl font-semibold mb-4">Categories</h3>
      <div className="grid gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={`bg-white border border-gray-200 p-4 rounded-lg flex justify-between items-center ${
              item.isActive ? 'opacity-100' : 'opacity-60'
            }`}
          >
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500 w-8">{item.order}</span>
              <div>
                <span className="font-medium">{item.value}</span>
                {!item.isActive && (
                  <span className="ml-2 text-xs bg-gray-600 text-white px-2 py-0.5 rounded">
                    Inactive
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onEdit(item)}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm border-none rounded cursor-pointer hover:bg-blue-700 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => handleToggle(item.id)}
                className={`px-3 py-1.5 text-white text-sm border-none rounded cursor-pointer transition-colors ${
                  item.isActive
                    ? 'bg-yellow-500 hover:bg-yellow-600'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {item.isActive ? 'Deactivate' : 'Activate'}
              </button>
              <button
                onClick={() => handleDelete(item.id, item.value)}
                className="px-3 py-1.5 bg-red-600 text-white text-sm border-none rounded cursor-pointer hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-center text-gray-600 italic py-4">
            No categories yet. Add one above!
          </p>
        )}
      </div>
    </div>
  )
}

