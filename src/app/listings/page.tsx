import { container } from "@/infrastructure/di/container";
import { format } from "date-fns";
import { ListingStatus } from "@/domain/value-objects/ListingStatus";
import Link from "next/link";

export const revalidate = 100;

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case ListingStatus.NEW:
      return "bg-gray-100 text-gray-800";
    case ListingStatus.ANALYZING:
      return "bg-blue-100 text-blue-800";
    case ListingStatus.ANALYZED:
      return "bg-green-100 text-green-800";
    case ListingStatus.IGNORED:
      return "bg-red-100 text-red-800";
    case ListingStatus.NOTIFIED:
      return "bg-purple-100 text-purple-800";
    case ListingStatus.ARCHIVED:
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export default async function ListingsPage() {
  const listings = await container.getNonNotifiedListingsUseCase.execute(100);

  return (
    <main className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm mb-4 inline-block">
          ← Retour à l'accueil
        </Link>
        <h1 className="text-3xl font-bold mb-2">
          📋 Produits non notifiés
        </h1>
        <p className="text-gray-600">
          {listings.length} produit{listings.length > 1 ? 's' : ''} trouvé{listings.length > 1 ? 's' : ''}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Image
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Titre
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Prix
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Recherche
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Analyse
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Raison
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {listings.map((listing) => (
                <tr key={listing.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    {listing.images[0] ? (
                      <img
                        src={listing.images[0].urlRemote}
                        alt={listing.title}
                        className="h-16 w-16 object-cover rounded"
                      />
                    ) : (
                      <div className="h-16 w-16 bg-gray-200 rounded flex items-center justify-center text-gray-400 text-xs">
                        No Img
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900 max-w-xs">
                      <a
                        href={listing.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-blue-600 hover:underline"
                      >
                        {listing.title}
                      </a>
                    </div>
                    {(listing.city || listing.region) && (
                      <div className="text-sm text-gray-500 mt-1">
                        {listing.city}{listing.city && listing.region ? ', ' : ''}{listing.region}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {(listing.priceCents / 100).toLocaleString('fr-FR', {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {listing.search.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeClass(
                        listing.status
                      )}`}
                    >
                      {listing.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {listing.aiAnalysis ? (
                      <div className="space-y-1">
                        <div>
                          Est: {(listing.aiAnalysis.estMinCents / 100).toLocaleString('fr-FR', {
                            style: 'currency',
                            currency: 'EUR',
                          })} - {(listing.aiAnalysis.estMaxCents / 100).toLocaleString('fr-FR', {
                            style: 'currency',
                            currency: 'EUR',
                          })}
                        </div>
                        <div>
                          Marge: {(listing.aiAnalysis.marginCents / 100).toLocaleString('fr-FR', {
                            style: 'currency',
                            currency: 'EUR',
                          })}
                        </div>
                        {listing.aiAnalysis.confidence !== null && (
                          <div className="text-xs">
                            Confiance: {Math.round(listing.aiAnalysis.confidence * 100)}%
                          </div>
                        )}
                        {listing.aiAnalysis.bestMatchSource && (
                          <div className="text-xs text-gray-400">
                            Source: {listing.aiAnalysis.bestMatchSource}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 max-w-xs">
                    <div className="line-clamp-3" title={listing.nonNotificationReason}>
                      {listing.nonNotificationReason}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(listing.createdAt, 'dd/MM/yyyy')}
                    <br />
                    <span className="text-xs text-gray-400">
                      {format(listing.createdAt, 'HH:mm')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {listing.images[0] && (
                        <a 
                          href={`https://lens.google.com/upload?url=${encodeURIComponent(listing.images[0].urlRemote)}`}
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                          title="Recherche Google Lens"
                        >
                          🔍
                        </a>
                      )}
                  </td>
                </tr>
              ))}
              {listings.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-4 text-center text-sm text-gray-500">
                    Aucun produit trouvé
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

