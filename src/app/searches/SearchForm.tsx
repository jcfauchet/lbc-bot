'use client'

import { useRef } from 'react'
import { createSearch } from './actions'

export function SearchForm() {
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <div className="bg-gray-50 p-6 rounded-lg mb-8">
      <h2 className="mb-4">Add New Search</h2>
      <form
        ref={formRef}
        action={async (formData) => {
          await createSearch(formData)
          formRef.current?.reset()
        }}
        className="flex gap-4 flex-wrap"
      >
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            name="name"
            placeholder="Search Name (e.g. Table basse laiton)"
            required
            className="w-full p-2 rounded border border-gray-300"
          />
        </div>
        <div className="flex-[2] min-w-[300px]">
          <input
            type="url"
            name="url"
            placeholder="LeBonCoin URL"
            required
            className="w-full p-2 rounded border border-gray-300"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white border-none rounded cursor-pointer hover:bg-blue-700 transition-colors"
        >
          Add Search
        </button>
      </form>
    </div>
  )
}
