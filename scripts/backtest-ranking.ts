/**
 * Backtest de classement — lecture seule, ne modifie rien.
 *
 * Question : peut-on classer les annonces mieux qu'avec la marge estimée par le LLM,
 * en apprenant sur les jugements humains deja en base ?
 *
 * Compare 3 classements sur les memes annonces jugees :
 *   A. marge estimee (comportement actuel)
 *   B. aleatoire (reference)
 *   C. score appris (regression logistique sur variables simples)
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { computeDealScore, isEstimateTrustworthy } from '../src/domain/services/DealScoring'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

/** Noms de designers / editeurs frequents sur cette niche. */
const DESIGNERS = [
  'panton', 'kartell', 'castiglioni', 'colombo', 'roche bobois', 'jansen', 'bagues',
  'vallauris', 'barrois', 'vandel', 'rega', 'lilienthal', 'piretti', 'artifort',
  'knoll', 'eames', 'aalto', 'jacobsen', 'wegner', 'juhl', 'adnet', 'perriand',
  'prouve', 'prouvé', 'royere', 'royère', 'guariche', 'paulin', 'mouille', 'biny',
  'leleu', 'arbus', 'ruhlmann', 'brandt', 'daum', 'galle', 'gallé', 'lalique',
  'murano', 'venini', 'mazzega', 'sciolari', 'stilnovo', 'arteluce', 'fontana arte',
  'flos', 'artemide', 'gubi', 'fritz hansen', 'cassina', 'zanotta', 'ligne roset',
  'airborne', 'steiner', 'thonet', 'baumann', 'maison charles', 'kjaernulf',
  'hollis jones', 'faleschini', 'mesmin', 'le dauphin', 'pearsall', 'kalmar',
]

type Row = {
  isGood: boolean
  price: number
  estMin: number
  estMax: number
  margin: number
  confidence: number
  triageScore: number
  rangeRatio: number
  hasDesigner: number
  srcLuxury: number
  srcSelency: number
  titleLen: number
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function toRow(f: {
  isGood: boolean
  listing: {
    title: string; priceCents: number; triageScore: number | null
    aiAnalysis: { estMinCents: number; estMaxCents: number; marginCents: number; confidence: number | null; bestMatchSource: string | null } | null
  }
}): Row | null {
  const a = f.listing.aiAnalysis
  if (!a) return null
  const price = f.listing.priceCents / 100
  const estMin = a.estMinCents / 100
  const estMax = a.estMaxCents / 100
  const src = norm(a.bestMatchSource ?? '')
  const title = norm(f.listing.title)
  return {
    isGood: f.isGood,
    price,
    estMin,
    estMax,
    margin: a.marginCents / 100,
    confidence: a.confidence ?? 0,
    triageScore: f.listing.triageScore ?? 0,
    rangeRatio: estMin > 0 ? estMax / estMin : 99,
    hasDesigner: DESIGNERS.some((d) => title.includes(d)) ? 1 : 0,
    srcLuxury: /1stdibs|chairish|pamono|invaluable|lot-art/.test(src) ? 1 : 0,
    srcSelency: /selency|proantic|leboncoin/.test(src) ? 1 : 0,
    titleLen: f.listing.title.length,
  }
}

const FEATURES: (keyof Row)[] = [
  'price', 'estMin', 'estMax', 'margin', 'confidence', 'triageScore',
  'rangeRatio', 'hasDesigner', 'srcLuxury', 'srcSelency', 'titleLen',
]

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1)
const std = (v: number[]) => {
  const m = mean(v)
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2))) || 1
}

/** Regression logistique, descente de gradient. */
function train(X: number[][], y: number[], epochs = 3000, lr = 0.1) {
  const n = X[0].length
  const w = new Array(n).fill(0)
  let b = 0
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(n).fill(0)
    let gb = 0
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((s, x, j) => s + x * w[j], b)
      const p = 1 / (1 + Math.exp(-z))
      const err = p - y[i]
      for (let j = 0; j < n; j++) gw[j] += err * X[i][j]
      gb += err
    }
    for (let j = 0; j < n; j++) w[j] -= (lr * gw[j]) / X.length
    b -= (lr * gb) / X.length
  }
  return { w, b }
}

const predict = (x: number[], w: number[], b: number) =>
  1 / (1 + Math.exp(-x.reduce((s, v, j) => s + v * w[j], b)))

/** Precision sur les K premiers d'un classement decroissant. */
function precisionAtK(scored: { score: number; isGood: boolean }[], k: number) {
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, k)
  return top.filter((t) => t.isGood).length / (top.length || 1)
}

/** AUC par comptage de paires concordantes. */
function auc(scored: { score: number; isGood: boolean }[]) {
  const pos = scored.filter((s) => s.isGood)
  const neg = scored.filter((s) => !s.isGood)
  if (!pos.length || !neg.length) return NaN
  let c = 0
  for (const p of pos) for (const n of neg) c += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0
  return c / (pos.length * neg.length)
}

async function main() {
  const fbs = await prisma.listingFeedback.findMany({
    include: {
      listing: {
        select: {
          title: true, priceCents: true, triageScore: true,
          aiAnalysis: { select: { estMinCents: true, estMaxCents: true, marginCents: true, confidence: true, bestMatchSource: true } },
        },
      },
    },
  })

  const rows = fbs.map(toRow).filter((r): r is Row => r !== null)
  const good = rows.filter((r) => r.isGood)
  const bad = rows.filter((r) => !r.isGood)
  console.log(`Jugements exploitables : ${rows.length}/${fbs.length} (avec analyse IA)`)
  console.log(`  bons: ${good.length} | mauvais: ${bad.length} | taux de base: ${((good.length / rows.length) * 100).toFixed(1)}%\n`)

  console.log('=== SEPARATION PAR VARIABLE (moyenne bons vs mauvais) ===')
  console.log('variable         bons        mauvais     ecart-type-norm')
  for (const f of FEATURES) {
    const g = good.map((r) => r[f] as number)
    const b = bad.map((r) => r[f] as number)
    const pooled = std([...g, ...b])
    const d = (mean(g) - mean(b)) / pooled
    const flag = Math.abs(d) > 0.3 ? '  <<<' : ''
    console.log(`${f.padEnd(16)} ${mean(g).toFixed(2).padStart(10)} ${mean(b).toFixed(2).padStart(11)} ${d.toFixed(3).padStart(12)}${flag}`)
  }

  // Standardisation
  const stats = FEATURES.map((f) => {
    const all = rows.map((r) => r[f] as number)
    return { m: mean(all), s: std(all) }
  })
  const vec = (r: Row) => FEATURES.map((f, j) => ((r[f] as number) - stats[j].m) / stats[j].s)

  console.log('\n=== BACKTEST : 20 tirages train/test (2/3 - 1/3) ===')
  const res = { margin: [] as number[], random: [] as number[], learned: [] as number[] }
  const aucs = { margin: [] as number[], random: [] as number[], learned: [] as number[] }
  const weightAcc = new Array(FEATURES.length).fill(0)

  for (let seed = 0; seed < 20; seed++) {
    const sh = [...rows].sort(() => Math.random() - 0.5)
    const cut = Math.floor(sh.length * 0.66)
    const tr = sh.slice(0, cut)
    const te = sh.slice(cut)
    const { w, b } = train(tr.map(vec), tr.map((r) => (r.isGood ? 1 : 0)))
    w.forEach((v, j) => (weightAcc[j] += v / 20))

    const K = Math.max(5, Math.floor(te.length * 0.25))
    const byMargin = te.map((r) => ({ score: r.margin, isGood: r.isGood }))
    const byRandom = te.map((r) => ({ score: Math.random(), isGood: r.isGood }))
    const byLearned = te.map((r) => ({ score: predict(vec(r), w, b), isGood: r.isGood }))

    res.margin.push(precisionAtK(byMargin, K))
    res.random.push(precisionAtK(byRandom, K))
    res.learned.push(precisionAtK(byLearned, K))
    aucs.margin.push(auc(byMargin))
    aucs.random.push(auc(byRandom))
    aucs.learned.push(auc(byLearned))
  }

  const pct = (v: number[]) => `${(mean(v) * 100).toFixed(1)}%`
  console.log(`  Precision@25% — marge estimee (actuel) : ${pct(res.margin)}`)
  console.log(`  Precision@25% — aleatoire              : ${pct(res.random)}`)
  console.log(`  Precision@25% — score appris           : ${pct(res.learned)}`)
  console.log(`\n  AUC — marge estimee : ${mean(aucs.margin).toFixed(3)}  (0.5 = hasard)`)
  console.log(`  AUC — aleatoire     : ${mean(aucs.random).toFixed(3)}`)
  console.log(`  AUC — score appris  : ${mean(aucs.learned).toFixed(3)}`)

  console.log('\n=== POIDS MOYENS DU MODELE (variables standardisees) ===')
  FEATURES.map((f, j) => ({ f, w: weightAcc[j] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .forEach(({ f, w }) => console.log(`  ${f.padEnd(16)} ${w > 0 ? '+' : ''}${w.toFixed(3)}${w > 0 ? '  (pousse vers BON)' : '  (pousse vers MAUVAIS)'}`))

  // ─────────────────────────────────────────────────────────────────────────
  // Evaluation du CODE DE PRODUCTION sur les memes jugements.
  // C'est la seule mesure qui compte : est-ce que ce qui est deploye fait mieux ?
  // ─────────────────────────────────────────────────────────────────────────
  const prodRows = fbs
    .filter((f) => f.listing.aiAnalysis)
    .map((f) => {
      const a = f.listing.aiAnalysis!
      const est = {
        priceCents: f.listing.priceCents,
        estMinCents: a.estMinCents,
        estMaxCents: a.estMaxCents,
        bestMatchSource: a.bestMatchSource,
      }
      return { isGood: f.isGood, est, margin: a.marginCents / 100 }
    })

  console.log('\n=== CODE DE PRODUCTION (DealScoring) sur les 240 jugements ===')

  const kept = prodRows.filter((r) => isEstimateTrustworthy(r.est))
  const dropped = prodRows.length - kept.length
  const precKept = kept.filter((r) => r.isGood).length / (kept.length || 1)
  const precDropped =
    prodRows.filter((r) => !isEstimateTrustworthy(r.est) && r.isGood).length / (dropped || 1)

  console.log(`  Garde-fou isEstimateTrustworthy :`)
  console.log(`    conservees : ${kept.length}/${prodRows.length} — dont ${(precKept * 100).toFixed(1)}% de bonnes`)
  console.log(`    ecartees   : ${dropped}/${prodRows.length} — dont ${(precDropped * 100).toFixed(1)}% de bonnes`)
  console.log(`    (taux de base global : ${((prodRows.filter((r) => r.isGood).length / prodRows.length) * 100).toFixed(1)}%)`)

  const K = Math.floor(prodRows.length * 0.25)
  const scoredProd = prodRows.map((r) => ({ score: computeDealScore(r.est), isGood: r.isGood }))
  const scoredMargin = prodRows.map((r) => ({ score: r.margin, isGood: r.isGood }))
  console.log(`\n  Classement sur l'ensemble des ${prodRows.length} jugements :`)
  console.log(`    Precision@${K} — marge estimee (avant) : ${(precisionAtK(scoredMargin, K) * 100).toFixed(1)}%`)
  console.log(`    Precision@${K} — computeDealScore      : ${(precisionAtK(scoredProd, K) * 100).toFixed(1)}%`)
  console.log(`    AUC — marge estimee (avant) : ${auc(scoredMargin).toFixed(3)}`)
  console.log(`    AUC — computeDealScore      : ${auc(scoredProd).toFixed(3)}`)

  // Pipeline complet : garde-fou PUIS classement.
  const scoredPipeline = kept.map((r) => ({ score: computeDealScore(r.est), isGood: r.isGood }))
  const Kp = Math.max(5, Math.floor(kept.length * 0.25))
  console.log(`\n  Pipeline complet (garde-fou + classement), top ${Kp} des survivants :`)
  console.log(`    Precision@${Kp} : ${(precisionAtK(scoredPipeline, Kp) * 100).toFixed(1)}%`)
}

main().finally(() => prisma.$disconnect())
