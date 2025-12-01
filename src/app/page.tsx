import { prisma } from "@/infrastructure/prisma/client";
import { ListingStatus } from "@/domain/value-objects/ListingStatus";
import { subDays, format } from "date-fns";
import { fr } from "date-fns/locale";

// Simple color palette for searches
const COLORS = [
  "bg-blue-500", "bg-green-500", "bg-yellow-500", "bg-red-500", 
  "bg-purple-500", "bg-pink-500", "bg-indigo-500", "bg-teal-500",
  "bg-orange-500", "bg-cyan-500"
];

async function getStats() {
  const now = new Date();
  const sevenDaysAgo = subDays(now, 7);

  // Get listings for the last 7 days with search info
  const listings = await prisma.lbcProductListing.findMany({
    where: {
      createdAt: {
        gte: sevenDaysAgo,
      },
    },
    select: {
      createdAt: true,
      status: true,
      search: {
        select: {
          name: true
        }
      }
    },
  });

  // Get unique search names for legend
  const searchNames = Array.from(new Set(listings.map(l => l.search.name))).sort();
  const searchColors = searchNames.reduce((acc, name, index) => {
    acc[name] = COLORS[index % COLORS.length];
    return acc;
  }, {} as Record<string, string>);

  // Group by day and search
  const listingsByDayAndSearch = listings.reduce((acc, listing) => {
    const day = format(listing.createdAt, "yyyy-MM-dd");
    if (!acc[day]) {
      acc[day] = { total: 0, bySearch: {} };
    }
    const searchName = listing.search.name;
    acc[day].bySearch[searchName] = (acc[day].bySearch[searchName] || 0) + 1;
    acc[day].total += 1;
    return acc;
  }, {} as Record<string, { total: number, bySearch: Record<string, number> }>);

  // Fill in missing days
  const dailyStats = [];
  for (let i = 6; i >= 0; i--) {
    const date = subDays(now, i);
    const dateKey = format(date, "yyyy-MM-dd");
    const dayData = listingsByDayAndSearch[dateKey] || { total: 0, bySearch: {} };
    
    dailyStats.push({
      date: date,
      label: format(date, "EEE d", { locale: fr }),
      total: dayData.total,
      bySearch: dayData.bySearch
    });
  }

  // Calculate Ignored vs Analyzed %
  const total = listings.length;
  const ignoredCount = listings.filter(l => l.status === ListingStatus.IGNORED).length;
  const analyzedCount = listings.filter(l => 
    [ListingStatus.ANALYZED, ListingStatus.NOTIFIED, ListingStatus.ARCHIVED].includes(l.status as ListingStatus)
  ).length;
  
  const processedTotal = ignoredCount + analyzedCount;
  const ignoredPercentage = processedTotal > 0 ? Math.round((ignoredCount / processedTotal) * 100) : 0;
  const analyzedPercentage = processedTotal > 0 ? Math.round((analyzedCount / processedTotal) * 100) : 0;

  // Get latest alerts
  const latestAlerts = await prisma.notification.findMany({
    take: 10,
    orderBy: {
      createdAt: 'desc'
    },
    include: {
      listing: {
        include: {
          images: {
            take: 1
          }
        }
      }
    }
  });

  return {
    dailyStats,
    ignoredPercentage,
    analyzedPercentage,
    totalProcessed: processedTotal,
    searchColors,
    searchNames,
    latestAlerts
  };
}

export default async function Home() {
  const stats = await getStats();
  const maxDailyCount = Math.max(...stats.dailyStats.map(d => d.total), 1);

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl mb-4">
          🤖 LBC Bot
        </h1>
        <p className="text-xl text-gray-600">
          Bot de sourcing Le Bon Coin avec IA
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-12">
        <h2 className="text-2xl mb-6">📊 Statistiques (7 derniers jours)</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Daily Listings Chart */}
          <div>
            <h3 className="text-lg font-medium mb-4 text-gray-700">Annonces récupérées par jour</h3>
            <div className="flex items-stretch space-x-2 h-48 pt-6 mb-4">
              {stats.dailyStats.map((day) => (
                <div key={day.label} className="flex-1 flex flex-col items-center group">
                  <div className="relative w-full flex flex-col-reverse justify-start flex-1 bg-gray-100 rounded-t">
                    {/* Stacked Bars */}
                    {Object.entries(day.bySearch).map(([searchName, count], index, array) => (
                      <div 
                        key={searchName}
                        className={`w-full ${stats.searchColors[searchName]} opacity-90 hover:opacity-100 transition-all relative group/segment hover:z-40 ${index === array.length - 1 ? 'rounded-t' : ''}`}
                        style={{ height: `${(count / maxDailyCount) * 100}%` }}
                      >
                        {/* Custom Tooltip */}
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 hidden group-hover/segment:block z-30 pointer-events-none">
                          <div className="bg-gray-900 text-white text-xs rounded py-1 px-2 whitespace-nowrap shadow-lg">
                            <span className="font-bold">{count}</span> {searchName}
                          </div>
                          {/* Arrow */}
                          <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-gray-900 absolute left-1/2 transform -translate-x-1/2 top-full"></div>
                        </div>
                      </div>
                    ))}
                    
                    {/* Total Count Tooltip (only show if not hovering a segment to avoid clutter? or keep it?) */}
                    {/* Keeping it simple, maybe move it up a bit or hide it when segment is hovered if possible, but CSS-only parent hover detection is tricky for siblings. 
                        Let's keep it but ensure z-index is lower or positioned differently. 
                        Actually, the segment tooltip will appear ON TOP of the total tooltip if they overlap, which is fine.
                    */}
                    <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-xs font-bold text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                      {day.total}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 rotate-0 truncate w-full text-center">
                    {day.label}
                  </div>
                </div>
              ))}
            </div>
            
            {/* Legend */}
            <div className="flex flex-wrap gap-2 text-xs">
              {stats.searchNames.map(name => (
                <div key={name} className="flex items-center">
                  <div className={`w-3 h-3 ${stats.searchColors[name]} rounded-full mr-1`}></div>
                  <span className="text-gray-600 truncate max-w-[100px]" title={name}>{name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Ignored vs Analyzed */}
          <div>
            <h3 className="text-lg font-medium mb-4 text-gray-700">Qualité du sourcing</h3>
            <div className="flex flex-col justify-center h-full pb-8">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Ignorés vs Analysés</span>
                <span className="text-sm text-gray-500">{stats.totalProcessed} annonces traitées</span>
              </div>
              
              <div className="h-8 w-full bg-gray-200 rounded-full overflow-hidden flex">
                <div 
                  className="h-full bg-red-400 flex items-center justify-center text-xs text-white font-bold"
                  style={{ width: `${stats.ignoredPercentage}%` }}
                >
                  {stats.ignoredPercentage > 5 && `${stats.ignoredPercentage}%`}
                </div>
                <div 
                  className="h-full bg-green-500 flex items-center justify-center text-xs text-white font-bold"
                  style={{ width: `${stats.analyzedPercentage}%` }}
                >
                  {stats.analyzedPercentage > 5 && `${stats.analyzedPercentage}%`}
                </div>
              </div>
              
              <div className="flex justify-between mt-2 text-sm">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-red-400 rounded-full mr-2"></div>
                  <span>Ignorés (hors cible)</span>
                </div>
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                  <span>Analysés (pertinents)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-12">
        <h2 className="text-2xl mb-6">🔔 Dernières Alertes</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
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
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {stats.latestAlerts.map((alert) => (
                <tr key={alert.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(alert.createdAt, "dd/MM/yyyy HH:mm")}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {alert.listing.images[0] ? (
                      <img 
                        src={alert.listing.images[0].urlRemote} 
                        alt={alert.listing.title} 
                        className="h-10 w-10 object-cover rounded"
                      />
                    ) : (
                      <div className="h-10 w-10 bg-gray-200 rounded flex items-center justify-center text-gray-400 text-xs">
                        No Img
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    <a href={alert.listing.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">
                      {alert.listing.title}
                    </a>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {(alert.listing.priceCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                      ${alert.status === 'sent' ? 'bg-green-100 text-green-800' : 
                        alert.status === 'error' ? 'bg-red-100 text-red-800' : 
                        'bg-yellow-100 text-yellow-800'}`}>
                      {alert.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {alert.listing.images[0] && (
                      <a 
                        href={`https://lens.google.com/upload?url=${encodeURIComponent(alert.listing.images[0].urlRemote)}`}
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
              {stats.latestAlerts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500">
                    Aucune alerte récente
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
