'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { resizeImage } from './resize-image'
import { isUploadTooHeavy, TOO_HEAVY_MESSAGE, uploadErrorMessage } from './upload-error'
import { addPhotos, removePhoto, MAX_PHOTOS } from './photo-selection'

type Reference = {
  id: string; name: string; note: string | null; maxPriceCents: number | null; isActive: boolean
  imageUrls: string[]; matchCount: number; matchedListingUrls: string[]
}

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200'

function ReferencesContent() {
  const key = useSearchParams().get('k') ?? ''
  const [references, setReferences] = useState<Reference[] | null>(null)
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [name, setName] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [note, setNote] = useState('')

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/references?k=${encodeURIComponent(key)}`)
      if (res.status === 401) { setLinkInvalid(true); return }
      if (res.ok) setReferences(await res.json())
    } catch {
      setError('Pas de connexion, réessaie dans un instant.')
    }
  }, [key])

  useEffect(() => { void load() }, [load])

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    // Read the FileList now: clearing the input below empties it, and the state
    // updater runs later.
    const picked = Array.from(e.target.files ?? [])
    setFiles((current) => addPhotos(current, picked))
    // Lets the same file be picked again after removing it.
    e.target.value = ''
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setMessage(null); setError(null)
    try {
      const body = new FormData()
      body.set('name', name); body.set('maxPrice', maxPrice); body.set('note', note)
      const blobs = await Promise.all(files.map(resizeImage))
      if (isUploadTooHeavy(blobs)) { setError(TOO_HEAVY_MESSAGE); return }
      blobs.forEach((blob, i) => body.append('images', blob, `photo-${i}.jpg`))
      const res = await fetch(`/api/references?k=${encodeURIComponent(key)}`, { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(uploadErrorMessage(res.status, json)); return }
      setMessage('Référence ajoutée ! Je regarde les annonces des 7 derniers jours dans le quart d’heure, puis chaque nouvelle annonce : tu reçois un mail dès que l’une lui ressemble.')
      setFiles([]); setName(''); setMaxPrice(''); setNote('')
      await load()
    } catch {
      setError('Pas de connexion, réessaie dans un instant.')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(ref: Reference) {
    try {
      const res = await fetch(`/api/references/${ref.id}?k=${encodeURIComponent(key)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isActive: !ref.isActive }),
      })
      if (!res.ok) { setError('Impossible de modifier cette référence, réessaie.'); return }
      await load()
    } catch {
      setError('Pas de connexion, réessaie dans un instant.')
    }
  }

  if (linkInvalid) {
    return (
      <main className="p-4 sm:p-8 max-w-xl mx-auto">
        <p className="text-gray-700">Lien invalide : utilise le bouton « 📸 Ajouter des références » d’un mail du bot.</p>
      </main>
    )
  }

  const canSubmit = files.length > 0 && name.trim() !== '' && !saving

  return (
    <main className="p-4 sm:p-8 max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">📸 Mes références</h1>
        <p className="text-sm text-gray-600">
          Ajoute des photos d’une pièce que tu cherches : dès qu’une annonce montre la même, tu reçois un mail.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-gray-800">Photos</span>
            <span className="text-xs text-gray-500">{files.length}/{MAX_PHOTOS} · plusieurs angles, c’est mieux</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {previews.map((url, i) => (
              <div key={url} className="relative aspect-square overflow-hidden rounded-lg border border-gray-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setFiles((current) => removePhoto(current, i))}
                  aria-label={`Retirer la photo ${i + 1}`}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm text-white"
                >
                  ✕
                </button>
              </div>
            ))}
            {files.length < MAX_PHOTOS && (
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-orange-300 bg-orange-50 text-orange-600 active:bg-orange-100">
                <span className="text-3xl leading-none">＋</span>
                <span className="px-1 text-center text-xs font-medium">{files.length === 0 ? 'Ajouter des photos' : 'Ajouter'}</span>
                <input type="file" accept="image/*" multiple onChange={pick} className="sr-only" />
              </label>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">Photos de ton téléphone ou captures d’écran (Instagram, Pamono, catalogue…).</p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-gray-800">Nom</span>
          <input className={inputClass} placeholder="ex. desserte Jansen laiton" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-gray-800">
            Prix max <span className="font-normal text-gray-500">(optionnel)</span>
          </span>
          <div className="relative">
            <input className={`${inputClass} pr-9`} placeholder="ex. 150" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">€</span>
          </div>
          <span className="text-xs text-gray-500">Je ne te préviens que si l’annonce est à ce prix ou moins.</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-gray-800">
            Note <span className="font-normal text-gray-500">(optionnel)</span>
          </span>
          <textarea
            className={`${inputClass} min-h-20`}
            placeholder="Détails qui comptent : pieds en laiton, plateaux en verre…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {message && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-orange-600 py-3.5 text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {saving ? 'Envoi…' : 'Ajouter la référence'}
        </button>
        <p className="-mt-2 text-center text-xs text-gray-500">
          Le bot ne voit que les annonces de ses recherches, entre 50 et 400 €.
        </p>
      </form>

      <h2 className="mb-3 mt-8 text-lg font-bold">Mes références {references && references.length > 0 && `(${references.length})`}</h2>
      {references?.length === 0 && <p className="text-sm text-gray-500">Aucune référence pour l’instant.</p>}
      <ul className="flex flex-col gap-3">
        {references?.map((ref) => (
          <li key={ref.id} className={`flex gap-3 rounded-lg border border-gray-200 bg-white p-3 ${ref.isActive ? '' : 'opacity-50'}`}>
            {ref.imageUrls[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ref.imageUrls[0]} alt={ref.name} className="h-16 w-16 shrink-0 rounded object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-900">{ref.name}</div>
              <div className="mt-0.5 text-xs text-gray-500">
                {ref.maxPriceCents !== null ? `max ${ref.maxPriceCents / 100} € · ` : ''}
                {ref.matchCount} trouvaille{ref.matchCount > 1 ? 's' : ''}
                {!ref.isActive && ' · en pause'}
              </div>
              {ref.matchedListingUrls.slice(0, 3).map((url) => (
                <a key={url} href={url} className="block truncate text-xs text-blue-600 hover:underline">{url}</a>
              ))}
            </div>
            <button
              type="button"
              onClick={() => toggle(ref)}
              className="self-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
            >
              {ref.isActive ? 'Pause' : 'Reprendre'}
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}

export default function ReferencesPage() {
  return (
    <Suspense fallback={<p className="p-4">Chargement…</p>}>
      <ReferencesContent />
    </Suspense>
  )
}
