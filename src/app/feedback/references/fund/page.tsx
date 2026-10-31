'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { HOUSE_LABELS, houseLabel, type AuctionHouse } from '@/domain/auction-houses'
import { LOT_CATEGORIES, LOT_CATEGORY_LABELS, type LotCategory } from '@/domain/lot-category'
import { thumbnailUrl } from './thumbnail'

type Lot = {
  house: AuctionHouse; title: string; artist: string | null; hammerCents: number; finalCents: number | null
  quantity: number; saleName: string; soldAt: string; lotUrl: string; imageUrl: string | null
}
type PageData = { total: number; page: number; pageSize: number; lots: Lot[] }

const euros = (cents: number) => `${Math.round(cents / 100).toLocaleString('fr-FR')} €`
const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

const selectClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200'

function FundContent() {
  const key = useSearchParams().get('k') ?? ''
  const [house, setHouse] = useState<AuctionHouse | ''>('')
  const [category, setCategory] = useState<LotCategory | ''>('')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PageData | null>(null)
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams({ k: key, page: String(page) })
    if (house) params.set('house', house)
    if (category) params.set('category', category)
    if (search) params.set('q', search)
    let cancelled = false
    setError(null)
    fetch(`/api/references/fund/lots?${params}`)
      .then(async (res) => {
        if (res.status === 401) { setLinkInvalid(true); return }
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as PageData
        if (!cancelled) setData(json)
      })
      .catch(() => { if (!cancelled) setError('Impossible de charger les lots, réessaie dans un instant.') })
    return () => { cancelled = true }
  }, [key, house, category, search, page])

  // Any filter change starts again from the first page.
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1) }

  if (linkInvalid) return <p className="p-4 text-sm text-red-600">Lien invalide.</p>
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <p className="mb-2 text-sm"><Link href={`/feedback/references?k=${encodeURIComponent(key)}`} className="text-orange-600">← Mes références</Link></p>
      <h1 className="mb-1 text-2xl font-bold">Fonds enchères</h1>
      <p className="mb-4 text-sm text-gray-500">
        Lots vendus servant de références photo. Le marteau marqué ≈ est déduit d’un prix publié frais compris.
      </p>

      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); filter(setSearch)(query.trim()) }}
      >
        <select id="house" aria-label="Maison" className={selectClass} value={house} onChange={(e) => filter(setHouse)(e.target.value as AuctionHouse | '')}>
          <option value="">Toutes les maisons</option>
          {(Object.keys(HOUSE_LABELS) as AuctionHouse[]).map((h) => <option key={h} value={h}>{HOUSE_LABELS[h]}</option>)}
        </select>
        <select id="category" aria-label="Catégorie" className={selectClass} value={category} onChange={(e) => filter(setCategory)(e.target.value as LotCategory | '')}>
          <option value="">Toutes les catégories</option>
          {LOT_CATEGORIES.map((c) => <option key={c} value={c}>{LOT_CATEGORY_LABELS[c]}</option>)}
        </select>
        <input
          id="search" type="search" placeholder="Créateur, objet…" className={`${selectClass} min-w-0 flex-1`}
          value={query} onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white">Chercher</button>
      </form>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {data && (
        <p className="mb-3 text-sm text-gray-500">
          {data.total.toLocaleString('fr-FR')} lots · page {data.page} sur {pages}
        </p>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {data?.lots.map((lot) => {
          const estimated = lot.house !== 'ARTCURIAL' && lot.finalCents !== null
          const thumb = thumbnailUrl(lot.imageUrl)
          return (
            <li key={lot.lotUrl} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <a href={lot.lotUrl} target="_blank" rel="noopener noreferrer" className="flex h-full flex-col">
                <div className="flex aspect-square items-center justify-center bg-gray-50">
                  {thumb && <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain" />}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">{houseLabel(lot.house)}</span>
                  <span className="line-clamp-3 text-sm font-medium text-gray-900">{lot.title}</span>
                  {lot.artist && <span className="text-xs text-gray-500">{lot.artist}</span>}
                  <span className="mt-auto text-lg font-bold text-gray-900">
                    {estimated ? '≈ ' : ''}{euros(lot.hammerCents)}
                    {lot.quantity > 1 && <span className="ml-1 text-xs font-normal text-gray-500">({lot.quantity} pièces)</span>}
                  </span>
                  <span className="text-xs text-gray-500">
                    {estimated && lot.finalCents !== null ? `${euros(lot.finalCents)} frais compris · ` : ''}{date(lot.soldAt)}
                  </span>
                </div>
              </a>
            </li>
          )
        })}
      </ul>
      {data?.lots.length === 0 && <p className="text-sm text-gray-500">Aucun lot pour ces filtres.</p>}

      {data && pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pagination">
          <button type="button" className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Précédente</button>
          <span className="text-sm text-gray-600">{page} / {pages}</span>
          <button type="button" className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivante →</button>
        </nav>
      )}
    </main>
  )
}

export default function FundPage() {
  return (
    <Suspense fallback={<p className="p-4">Chargement…</p>}>
      <FundContent />
    </Suspense>
  )
}
