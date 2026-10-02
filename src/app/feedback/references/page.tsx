'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { resizeImage } from './resize-image'

type Reference = {
  id: string; name: string; note: string | null; maxPriceCents: number | null; isActive: boolean
  imageUrls: string[]; matchCount: number; matchedListingUrls: string[]
}

function ReferencesContent() {
  const key = useSearchParams().get('k') ?? ''
  const [references, setReferences] = useState<Reference[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [name, setName] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/references?k=${encodeURIComponent(key)}`)
    if (!res.ok) { setError('Lien invalide : utilise le bouton « Ajouter des références » d’un mail du bot.'); return }
    setReferences(await res.json())
  }, [key])

  useEffect(() => { void load() }, [load])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setMessage(null); setError(null)
    try {
      const body = new FormData()
      body.set('name', name); body.set('maxPrice', maxPrice); body.set('note', note)
      for (const [i, file] of files.entries()) body.append('images', await resizeImage(file), `photo-${i}.jpg`)
      const res = await fetch(`/api/references?k=${encodeURIComponent(key)}`, { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Erreur, réessaie.'); return }
      setMessage('Référence ajoutée. Je regarde les annonces des 7 derniers jours dans le quart d’heure, puis chaque nouvelle annonce : tu reçois un mail dès que l’une lui ressemble.')
      setFiles([]); setName(''); setMaxPrice(''); setNote('')
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function toggle(ref: Reference) {
    await fetch(`/api/references/${ref.id}?k=${encodeURIComponent(key)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isActive: !ref.isActive }),
    })
    await load()
  }

  if (error && !references) return <p style={{ padding: 16 }}>{error}</p>

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: 16, fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ fontSize: 22 }}>📸 Mes références</h1>
      <p style={{ color: '#666', fontSize: 14 }}>
        Ajoute des photos d’une pièce que tu cherches : dès qu’une annonce montre la même, tu reçois un mail.
        Le bot ne voit que les annonces de ses recherches, entre 50 et 400 €.
      </p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 10, margin: '16px 0 28px' }}>
        <input type="file" accept="image/*" multiple required
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
        {files.length > 0 && <small>{files.length} photo{files.length > 1 ? 's' : ''} (5 max)</small>}
        <input placeholder="Nom (ex. desserte Jansen laiton)" value={name} onChange={(e) => setName(e.target.value)} required
          style={{ padding: 10, fontSize: 16 }} />
        <input placeholder="Prix max (optionnel, ex. 150)" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}
          style={{ padding: 10, fontSize: 16 }} />
        <textarea placeholder="Note (optionnel : détails qui comptent)" value={note} onChange={(e) => setNote(e.target.value)}
          style={{ padding: 10, fontSize: 16, minHeight: 70 }} />
        <button type="submit" disabled={saving}
          style={{ padding: 14, fontSize: 16, fontWeight: 'bold', background: '#ff6b00', color: 'white', border: 0, borderRadius: 8 }}>
          {saving ? 'Envoi…' : 'Ajouter la référence'}
        </button>
        {message && <p style={{ color: '#16a34a' }}>{message}</p>}
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      </form>

      {references?.map((ref) => (
        <div key={ref.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderTop: '1px solid #eee', opacity: ref.isActive ? 1 : 0.5 }}>
          {ref.imageUrls[0] && <img src={ref.imageUrls[0]} alt={ref.name} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{ref.name}</strong>
            <div style={{ fontSize: 13, color: '#666' }}>
              {ref.maxPriceCents !== null ? `max ${ref.maxPriceCents / 100} € · ` : ''}
              {ref.matchCount} trouvaille{ref.matchCount > 1 ? 's' : ''}
            </div>
            {ref.matchedListingUrls.slice(0, 3).map((url) => (
              <a key={url} href={url} style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{url}</a>
            ))}
          </div>
          <button onClick={() => toggle(ref)} style={{ alignSelf: 'center', padding: '8px 10px' }}>
            {ref.isActive ? 'Pause' : 'Reprendre'}
          </button>
        </div>
      ))}
    </main>
  )
}

export default function ReferencesPage() {
  return (
    <Suspense fallback={<p style={{ padding: 16 }}>Chargement…</p>}>
      <ReferencesContent />
    </Suspense>
  )
}
