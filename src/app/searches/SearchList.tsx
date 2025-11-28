'use client'

import { deleteSearch, toggleSearchStatus } from './actions'

type Search = {
  id: string
  name: string
  url: string
  isActive: boolean
  createdAt: Date
}

export function SearchList({ searches }: { searches: Search[] }) {
  return (
    <div className="grid gap-4">
      {searches.map((search) => (
        <div
          key={search.id}
          className={`bg-white border border-gray-200 p-4 rounded-lg flex justify-between items-center ${
            search.isActive ? 'opacity-100' : 'opacity-60'
          }`}
        >
          <div className="overflow-hidden">
            <h3 className="m-0 mb-2 flex items-center gap-2">
              {search.name}
              {!search.isActive && (
                <span className="text-xs bg-gray-600 text-white px-2 py-0.5 rounded">
                  Paused
                </span>
              )}
            </h3>
            <a
              href={search.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 no-underline text-sm whitespace-nowrap overflow-hidden text-ellipsis block hover:underline"
            >
              {search.url}
            </a>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => toggleSearchStatus(search.id)}
              className={`px-4 py-2 text-white border-none rounded cursor-pointer transition-colors ${
                search.isActive
                  ? 'bg-yellow-500 hover:bg-yellow-600'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {search.isActive ? 'Pause' : 'Activate'}
            </button>
            <button
              onClick={() => {
                if (confirm('Are you sure you want to delete this search?')) {
                  deleteSearch(search.id)
                }
              }}
              className="px-4 py-2 bg-red-600 text-white border-none rounded cursor-pointer hover:bg-red-700 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      {searches.length === 0 && (
        <p className="text-center text-gray-600 italic">
          No searches configured yet. Add one above!
        </p>
      )}
    </div>
  )
}
