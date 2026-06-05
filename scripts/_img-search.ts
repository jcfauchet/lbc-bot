import 'dotenv/config'
const KEY = process.env.SERPAPI_KEY!
async function search(q: string, n = 8) {
  const u = new URL('https://serpapi.com/search.json')
  u.searchParams.set('engine', 'google_images')
  u.searchParams.set('q', q)
  u.searchParams.set('api_key', KEY)
  const r = await fetch(u); const j = await r.json()
  const imgs = (j.images_results ?? []).slice(0, n)
  console.log(`\n### query: ${q}`)
  for (const im of imgs) console.log(`${im.position}\t${im.original}\t<= ${im.source}`)
}
async function main() {
  await search('vide grenier meuble vintage fouillis maison', 8)
  await search('leboncoin lampe vintage salon encombré', 8)
}
main()
