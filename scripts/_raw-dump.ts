import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import vision from '@google-cloud/vision'
const dom = (u?: string|null) => { try { return new URL(u!).hostname.replace(/^www\./,'') } catch { return u } }
async function main() {
  const client = new vision.ImageAnnotatorClient()
  const bytes = await readFile(process.argv[2])
  const [r] = await client.webDetection({ image: { content: bytes.toString('base64') } })
  const w = r.webDetection ?? {}
  console.log('--- ALL pagesWithMatchingImages ---')
  for (const p of (w.pagesWithMatchingImages ?? [])) console.log(' ', dom(p.url), '::', (p.pageTitle||'').slice(0,70))
  console.log('--- ALL visuallySimilarImages domains ---')
  for (const s of (w.visuallySimilarImages ?? [])) console.log(' ', dom(s.url))
  console.log('--- fullMatchingImages ---')
  for (const s of (w.fullMatchingImages ?? [])) console.log(' ', dom(s.url))
  console.log('--- partialMatchingImages ---')
  for (const s of (w.partialMatchingImages ?? [])) console.log(' ', dom(s.url))
}
main()
