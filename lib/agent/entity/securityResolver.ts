import { matchStocks } from '@/lib/agent/entity/stockMatcher'
import { resolveExternalCandidates, type ExternalCandidateSource } from '@/lib/agent/entity/externalCandidates'
import type { Market, Stock } from '@/types'

export type SecurityCandidateSource = 'portfolio' | ExternalCandidateSource | 'inference'

export type SecurityCandidate = {
  code: string
  name: string
  market: Market
  confidence: number
  inPortfolio: boolean
  stockId?: string
  source: SecurityCandidateSource
}

function candidateKey(candidate: Pick<SecurityCandidate, 'code' | 'market'>) {
  return `${candidate.market}:${candidate.code.toUpperCase()}`
}

function dedupeSecurityCandidates(candidates: SecurityCandidate[]) {
  const seen = new Set<string>()
  const deduped: SecurityCandidate[] = []
  for (const candidate of candidates) {
    const key = candidateKey(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(candidate)
  }
  return deduped
}

export async function resolveSecurityCandidates(query: string, stocks: Stock[], limit = 5): Promise<SecurityCandidate[]> {
  const normalized = query.trim()
  if (!normalized) return []

  const local = matchStocks(normalized, stocks, limit).map((match): SecurityCandidate => ({
    code: match.stock.code,
    name: match.stock.name,
    market: match.stock.market,
    confidence: match.confidence,
    inPortfolio: true,
    stockId: match.stock.id,
    source: 'portfolio',
  }))
  if (local.length) return local

  const external = (await resolveExternalCandidates(normalized, limit)).map((candidate): SecurityCandidate => {
    const held = stocks.find((stock) => stock.code.toUpperCase() === candidate.code.toUpperCase() && stock.market === candidate.market)
    return {
      code: candidate.code,
      name: held?.name ?? candidate.name,
      market: candidate.market,
      confidence: held ? Math.max(candidate.confidence, 0.92) : candidate.confidence,
      inPortfolio: Boolean(held),
      stockId: held?.id,
      source: held ? 'portfolio' : candidate.source ?? 'inference',
    }
  })

  return dedupeSecurityCandidates([...local, ...external])
    .sort((left, right) => {
      if (left.inPortfolio !== right.inPortfolio) return left.inPortfolio ? -1 : 1
      return right.confidence - left.confidence
    })
    .slice(0, limit)
}
