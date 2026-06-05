#!/usr/bin/env node
import 'dotenv/config'

/**
 * SPIKE (throwaway): validate the core hypothesis behind the funnel rework.
 *
 * Hypothesis: given a photo from a generically-titled listing, a reverse-image
 * search surfaces visually similar pieces that actually sold for high prices —
 * WITHOUT having to name a designer first.
 *
 * This calls Google Vision "Web Detection" through the official SDK, which
 * authenticates via GOOGLE_APPLICATION_CREDENTIALS (./google.json).
 *
 * Usage:
 *   pnpm tsx scripts/spike-visual-comps.ts <imageUrlOrLocalPath> [moreUrls...]
 */

import { readFile } from 'node:fs/promises'
import vision from '@google-cloud/vision'

const client = new vision.ImageAnnotatorClient()

// Domains that signal real resale value (auction houses + high-end design marketplaces).
const VALUE_DOMAINS = [
  'selency',
  '1stdibs',
  'pamono',
  'design-market',
  'drouot',
  'interencheres',
  'auction.fr',
  'auction',
  'catawiki',
  'sothebys',
  'christies',
  'artsy',
  'invaluable',
  'pamono',
  'chairish',
]

type WebImage = { url: string; score?: number }
type WebPage = { url: string; pageTitle?: string }
type WebEntity = { description?: string; score?: number }

type WebDetection = {
  webEntities?: WebEntity[]
  bestGuessLabels?: { label: string; languageCode?: string }[]
  fullMatchingImages?: WebImage[]
  partialMatchingImages?: WebImage[]
  pagesWithMatchingImages?: WebPage[]
  visuallySimilarImages?: WebImage[]
}

function isValueDomain(url: string): boolean {
  const lower = url.toLowerCase()
  return VALUE_DOMAINS.some((d) => lower.includes(d))
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function buildImage(src: string): Promise<Record<string, unknown>> {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return { source: { imageUri: src } }
  }
  const bytes = await readFile(src)
  return { content: bytes.toString('base64') }
}

async function detect(src: string): Promise<WebDetection> {
  const image = await buildImage(src)
  const [result] = await client.webDetection({ image })
  return (result.webDetection ?? {}) as WebDetection
}

function report(src: string, web: WebDetection): void {
  console.log('\n' + '='.repeat(80))
  console.log('IMAGE:', src)
  console.log('='.repeat(80))

  const guesses = web.bestGuessLabels?.map((g) => g.label) ?? []
  console.log('\n🔮 Best guess (what the piece probably is):')
  console.log('   ', guesses.length ? guesses.join(' | ') : '(none)')

  console.log('\n🏷️  Web entities (concepts the image evokes):')
  for (const e of (web.webEntities ?? []).slice(0, 10)) {
    if (!e.description) continue
    console.log(`    ${e.score?.toFixed(2) ?? '   '}  ${e.description}`)
  }

  const pages = web.pagesWithMatchingImages ?? []
  const valuePages = pages.filter((p) => isValueDomain(p.url))
  console.log(`\n📄 Pages with matching image: ${pages.length} total, ${valuePages.length} on value domains`)
  for (const p of valuePages.slice(0, 8)) {
    console.log(`    ⭐ [${domainOf(p.url)}] ${p.pageTitle ?? ''}`)
    console.log(`       ${p.url}`)
  }
  // Show a few non-value pages too, for context.
  for (const p of pages.filter((p) => !isValueDomain(p.url)).slice(0, 4)) {
    console.log(`       [${domainOf(p.url)}] ${p.pageTitle ?? ''}`)
  }

  const similar = web.visuallySimilarImages ?? []
  const valueSimilar = similar.filter((s) => isValueDomain(s.url))
  console.log(`\n🖼️  Visually similar images: ${similar.length} total, ${valueSimilar.length} on value domains`)
  for (const s of valueSimilar.slice(0, 8)) {
    console.log(`    ⭐ [${domainOf(s.url)}] ${s.url}`)
  }

  // Verdict heuristic for the spike.
  const valueHits = valuePages.length + valueSimilar.length
  console.log('\n🧪 SPIKE SIGNAL:', valueHits > 0
    ? `✅ ${valueHits} hit(s) on auction/design domains — the funnel idea has legs here`
    : '❌ no auction/design-domain hits — visual match alone is weak for this item')
}

async function main(): Promise<void> {
  const sources = process.argv.slice(2)
  if (sources.length === 0) {
    console.error('Usage: pnpm tsx scripts/spike-visual-comps.ts <imageUrlOrPath> [more...]')
    process.exit(1)
  }

  for (const src of sources) {
    try {
      const web = await detect(src)
      report(src, web)
    } catch (err) {
      console.error(`\n❌ Failed on ${src}:`, (err as Error).message)
    }
  }
}

main()
