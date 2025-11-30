'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createCategory, updateCategory } from './actions'

type CategoryItem = {
  id: string
  value: string
  order: number
  isActive: boolean
}

interface CategoryFormProps {
  item?: CategoryItem
  onSuccess?: () => void
}

export function TaxonomyForm({ item, onSuccess }: CategoryFormProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [isEditing, setIsEditing] = useState(!!item)

  const handleSubmit = async (formData: FormData) => {
    if (item) {
      await updateCategory(item.id, formData)
    } else {
      await createCategory(formData)
    }
    formRef.current?.reset()
    if (onSuccess) {
      onSuccess()
    } else {
      router.refresh()
    }
    if (isEditing) {
      setIsEditing(false)
    }
  }

  return (
    <div className="bg-gray-50 p-6 rounded-lg mb-6">
      <h3 className="mb-4 text-lg font-semibold">
        {isEditing ? 'Edit Category' : 'Add New Category'}
      </h3>
      <form
        ref={formRef}
        action={handleSubmit}
        className="flex gap-4 flex-wrap items-end"
      >
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="value" className="block text-sm font-medium mb-1">
            Value
          </label>
          <input
            type="text"
            id="value"
            name="value"
            defaultValue={item?.value}
            placeholder={`e.g. table_basse`}
            required
            className="w-full p-2 rounded border border-gray-300"
          />
        </div>
        <div className="w-24">
          <label htmlFor="order" className="block text-sm font-medium mb-1">
            Order
          </label>
          <input
            type="number"
            id="order"
            name="order"
            defaultValue={item?.order ?? 0}
            min="0"
            className="w-full p-2 rounded border border-gray-300"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isActive"
            name="isActive"
            defaultChecked={item?.isActive ?? true}
            value="true"
            className="w-4 h-4"
          />
          <label htmlFor="isActive" className="text-sm font-medium">
            Active
          </label>
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white border-none rounded cursor-pointer hover:bg-blue-700 transition-colors"
        >
          {isEditing ? 'Update' : 'Add'}
        </button>
        {isEditing && (
          <button
            type="button"
            onClick={() => {
              setIsEditing(false)
              formRef.current?.reset()
            }}
            className="px-4 py-2 bg-gray-500 text-white border-none rounded cursor-pointer hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
        )}
      </form>
    </div>
  )
}

