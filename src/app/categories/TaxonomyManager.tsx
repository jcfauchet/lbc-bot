'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TaxonomyForm } from './TaxonomyForm'
import { TaxonomyList } from './TaxonomyList'

type CategoryItem = {
  id: string
  value: string
  order: number
  isActive: boolean
}

interface CategoryManagerProps {
  categories: CategoryItem[]
}

export function TaxonomyManager({ categories }: CategoryManagerProps) {
  const router = useRouter()
  const [editingItem, setEditingItem] = useState<CategoryItem | null>(null)

  const handleEdit = (item: CategoryItem) => {
    setEditingItem(item)
  }

  const handleFormSuccess = () => {
    setEditingItem(null)
    router.refresh()
  }

  return (
    <div>
      <TaxonomyForm
        item={editingItem || undefined}
        onSuccess={handleFormSuccess}
      />

      <TaxonomyList
        items={categories}
        onEdit={handleEdit}
      />
    </div>
  )
}

