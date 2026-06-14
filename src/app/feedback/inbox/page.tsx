import { container } from '@/infrastructure/di/container'
import { FeedbackButton } from '@/components/FeedbackButton'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

const euro = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

export default async function FeedbackInboxPage() {
  const items = await container.getRecentNotifiedListingsUseCase.execute()
  const feedbackMap = await container.feedbackRepository.findByListingIds(
    items.map((i) => i.listing.id)
  )

  // Surface the not-yet-rated listings first so there is nothing to hunt for.
  const sorted = [...items].sort((a, b) => {
    const aRated = feedbackMap.has(a.listing.id) ? 1 : 0
    const bRated = feedbackMap.has(b.listing.id) ? 1 : 0
    if (aRated !== bRated) return aRated - bRated
    return b.notifiedAt.getTime() - a.notifiedAt.getTime()
  })

  const ratedCount = sorted.filter((i) => feedbackMap.has(i.listing.id)).length

  return (
    <main className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">🗳️ Noter les annonces</h1>
        <p className="text-sm text-gray-600">
          {sorted.length} annonce{sorted.length > 1 ? 's' : ''} notifiée
          {sorted.length > 1 ? 's' : ''} sur 14 jours · {ratedCount} déjà notée
          {ratedCount > 1 ? 's' : ''}. Note tout d&apos;ici, pas besoin de
          revenir au mail.
        </p>
      </div>

      {sorted.length === 0 && (
        <p className="text-sm text-gray-500">Aucune annonce notifiée récemment.</p>
      )}

      <ul className="flex flex-col gap-3">
        {sorted.map((item) => {
          const { listing } = item
          const existing = feedbackMap.get(listing.id)
          return (
            <li
              key={listing.id}
              className="flex gap-3 items-start border border-gray-200 rounded-lg p-3 bg-white"
            >
              {listing.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={listing.imageUrl}
                  alt={listing.title}
                  className="h-16 w-16 object-cover rounded shrink-0"
                />
              ) : (
                <div className="h-16 w-16 bg-gray-100 rounded shrink-0 flex items-center justify-center text-gray-400 text-xs">
                  No Img
                </div>
              )}

              <div className="flex-1 min-w-0">
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline line-clamp-2"
                >
                  {listing.title}
                </a>
                <div className="text-xs text-gray-500 mt-0.5">
                  {euro(listing.priceCents)}
                  {listing.aiAnalysis && (
                    <>
                      {' · estimé '}
                      {euro(listing.aiAnalysis.estMinCents)}–
                      {euro(listing.aiAnalysis.estMaxCents)}
                      <span
                        className={
                          listing.aiAnalysis.marginCents >= 0
                            ? 'text-green-600'
                            : 'text-red-600'
                        }
                      >
                        {' '}
                        ({listing.aiAnalysis.marginCents >= 0 ? '+' : ''}
                        {euro(listing.aiAnalysis.marginCents)})
                      </span>
                    </>
                  )}
                  {' · '}
                  {format(item.notifiedAt, 'dd/MM')}
                </div>
              </div>

              <div className="shrink-0">
                <FeedbackButton
                  listingId={listing.id}
                  initialFeedbackId={existing?.id ?? null}
                  initialVote={existing ? (existing.isGood ? 'good' : 'bad') : null}
                  initialComment={existing?.comment ?? null}
                  placeholder="Vendu ? À quel prix ? (optionnel)"
                />
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
