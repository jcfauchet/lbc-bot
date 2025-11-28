'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TaxonomyForm } from './TaxonomyForm'
import { TaxonomyList } from './TaxonomyList'

type TaxonomyItem = {
  id: string
  value: string
  order: number
  isActive: boolean
}

interface TaxonomyManagerProps {
  categories: TaxonomyItem[]
  periods: TaxonomyItem[]
  materials: TaxonomyItem[]
  styles: TaxonomyItem[]
}

type TaxonomyType = 'category' | 'period' | 'material' | 'style'

export function TaxonomyManager({
  categories,
  periods,
  materials,
  styles,
}: TaxonomyManagerProps) {
  const router = useRouter()
  const [editingItem, setEditingItem] = useState<{
    type: TaxonomyType
    item: TaxonomyItem
  } | null>(null)
  const [activeTab, setActiveTab] = useState<TaxonomyType>('category')

  const tabs = [
    { id: 'category' as const, label: 'Categories', count: categories.length },
    { id: 'period' as const, label: 'Periods', count: periods.length },
    { id: 'material' as const, label: 'Materials', count: materials.length },
    { id: 'style' as const, label: 'Styles', count: styles.length },
  ]

  const getItems = (type: TaxonomyType) => {
    switch (type) {
      case 'category':
        return categories
      case 'period':
        return periods
      case 'material':
        return materials
      case 'style':
        return styles
    }
  }

  const handleEdit = (type: TaxonomyType, item: TaxonomyItem) => {
    setEditingItem({ type, item })
    setActiveTab(type)
  }

  const handleFormSuccess = () => {
    setEditingItem(null)
    router.refresh()
  }

  return (
    <div>
      <div className="mb-6 border-b border-gray-200">
        <nav className="flex gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id)
                setEditingItem(null)
              }}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </nav>
      </div>

      <TaxonomyForm
        type={activeTab}
        item={editingItem?.type === activeTab ? editingItem.item : undefined}
        onSuccess={handleFormSuccess}
      />

      <TaxonomyList
        type={activeTab}
        items={getItems(activeTab)}
        onEdit={(item) => handleEdit(activeTab, item)}
      />
    </div>
  )
}

