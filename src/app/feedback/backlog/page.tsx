import { container } from '@/infrastructure/di/container'
import { FeedbackButton } from '@/components/FeedbackButton'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

const euro = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

const SCORE_FILTERS = [
  { label: 'Score 9', value: 9 },
  { label: '8+', value: 8 },
  { label: '7+', value: 7 },
  { label: 'Tous', value: 0 },
]

const scoreColor = (s: number | null) =>
  s == null ? 'bg-gray-100 text-gray-500'
    : s >= 9 ? 'bg-green-100 text-green-700'
    : s >= 8 ? 'bg-lime-100 text-lime-700'
    : s >= 7 ? 'bg-yellow-100 text-yellow-700'
    : 'bg-gray-100 text-gray-600'

export default async function BacklogPage({
  searchParams,
}: {
  searchParams: Promise<{ minScore?: string }>
}) {
  const { minScore: rawMinScore } = await searchParams
  const minScore = rawMinScore != null ? Number(rawMinScore) : 9

  const items = await container.getTriageBacklogUseCase.execute({ minScore, limit: 500 })
  const feedbackMap = await container.feedbackRepository.findByListingIds(
    items.map((i) => i.id)
  )

  // Surface the not-yet-qualified first so there is nothing to hunt for.
  const sorted = [...items].sort((a, b) => {
    const aRated = feedbackMap.has(a.id) ? 1 : 0
    const bRated = feedbackMap.has(b.id) ? 1 : 0
    if (aRated !== bRated) return aRated - bRated
    return (b.triageScore ?? 0) - (a.triageScore ?? 0)
  })

  const ratedCount = sorted.filter((i) => feedbackMap.has(i.id)).length

  return (
    <main className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold mb-1">📦 Backlog à qualifier</h1>
        <p className="text-sm text-gray-600">
          {sorted.length} annonce{sorted.length > 1 ? 's' : ''} en attente d&apos;analyse
          {' '}· {ratedCount} déjà qualifiée{ratedCount > 1 ? 's' : ''}. Ton 👍/👎
          {' '}nourrit l&apos;apprentissage du bot.
        </p>
      </div>

      <div className="flex gap-2 mb-6">
        {SCORE_FILTERS.map((f) => {
          const active = minScore === f.value
          return (
            <a
              key={f.value}
              href={`/feedback/backlog?minScore=${f.value}`}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                active
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
              }`}
            >
              {f.label}
            </a>
          )
        })}
      </div>

      {sorted.length === 0 && (
        <p className="text-sm text-gray-500">Rien à ce niveau de score.</p>
      )}

      <ul className="flex flex-col gap-3">
        {sorted.map((item) => {
          const existing = feedbackMap.get(item.id)
          return (
            <li
              key={item.id}
              className="flex gap-3 items-start border border-gray-200 rounded-lg p-3 bg-white"
            >
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  loading="lazy"
                  className="h-20 w-20 object-cover rounded shrink-0"
                />
              ) : (
                <div className="h-20 w-20 bg-gray-100 rounded shrink-0 flex items-center justify-center text-gray-400 text-xs">
                  No Img
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${scoreColor(item.triageScore)}`}>
                    {item.triageScore ?? '–'}/10
                  </span>
                  <span className="text-xs text-gray-400">
                    {item.city ?? ''} · vue le {format(item.createdAt, 'dd/MM')}
                  </span>
                </div>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline line-clamp-2"
                >
                  {item.title}
                </a>
                <div className="text-sm text-gray-700 mt-0.5 font-semibold">
                  {euro(item.priceCents)}
                </div>
              </div>

              <div className="shrink-0">
                <FeedbackButton
                  listingId={item.id}
                  initialFeedbackId={existing?.id ?? null}
                  initialVote={existing ? (existing.isGood ? 'good' : 'bad') : null}
                  placeholder="Pourquoi ? (optionnel)"
                />
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
