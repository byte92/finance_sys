import { detectStockCode } from '@/lib/agent/entity/stockMatcher'
import type { Market } from '@/types'

export type ExternalCandidateSource = 'tencent.smartbox' | 'code.inference'

export type ExternalCandidate = {
  code: string
  name: string
  market: Market
  confidence: number
  source?: ExternalCandidateSource
}

const MARKET_OPTIONS: Market[] = ['A', 'HK', 'US']

function normalize(input: string) {
  return input
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?;；:：()[\]{}"'“”‘’]/g, '')
}

function normalizeSmartboxSymbol(exchange: string, symbol: string) {
  if (exchange === 'us') return symbol.split('.')[0]?.toUpperCase() ?? symbol.toUpperCase()
  if (exchange === 'hk') return symbol.padStart(5, '0')
  return symbol.padStart(6, '0')
}

function marketFromSmartboxExchange(exchange: string): Market | null {
  if (exchange === 'sh' || exchange === 'sz' || exchange === 'bj') return 'A'
  if (exchange === 'hk') return 'HK'
  if (exchange === 'us') return 'US'
  return null
}

function decodeSmartboxText(value: string) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string
  } catch {
    return value
  }
}

function buildNumberNameQueries(compact: string) {
  const queries: string[] = []
  for (let end = 0; end < compact.length; end++) {
    if (!/\d/.test(compact[end])) continue
    for (let start = Math.max(0, end - 9); start < end; start++) {
      const item = compact.slice(start, end + 1)
      if (/[\u4e00-\u9fff]/.test(item) && /\d/.test(item) && item.length >= 3) {
        queries.push(item)
      }
    }
  }
  return queries.sort((left, right) => right.length - left.length)
}

function buildGenericSearchQueries(query: string) {
  const compact = query
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?;；:：()[\]{}"'“”‘’]/g, '')
  const candidates: string[] = [query.trim(), compact, ...buildNumberNameQueries(compact)].filter(Boolean)
  const spans = compact.match(/[\u4e00-\u9fffA-Za-z0-9]+/g) ?? []

  for (const span of spans) {
    if (span.length < 2) continue
    const maxLength = Math.min(span.length, 12)
    for (let length = maxLength; length >= 2; length--) {
      for (let start = 0; start + length <= span.length; start++) {
        candidates.push(span.slice(start, start + length))
      }
    }
  }

  return Array.from(new Set(candidates)).slice(0, 80)
}

function parseTencentSmartboxCandidates(raw: string, query: string): ExternalCandidate[] {
  const match = raw.match(/v_hint="([\s\S]*)";?/)
  if (!match?.[1] || match[1] === 'N') return []

  const normalizedQuery = normalize(query)
  const payload = decodeSmartboxText(match[1])
  const candidates: ExternalCandidate[] = []

  const items = payload.split('^')
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const [exchange, symbol, rawName, _pinyin, type] = item.split('~')
    if (!exchange || !symbol || !rawName || !type) continue
    if (!(type.startsWith('GP') || type === 'ETF')) continue

    const market = marketFromSmartboxExchange(exchange)
    if (!market) continue

    const name = rawName.trim()
    const normalizedName = normalize(name)
    const normalizedSymbol = normalize(symbol)
    const confidence = normalizedQuery.includes(normalizedName) || normalizedQuery.includes(normalizedSymbol)
      ? 0.86
      : Math.max(0.62, 0.78 - index * 0.03)

    candidates.push({
      code: normalizeSmartboxSymbol(exchange, symbol),
      name,
      market,
      confidence,
      source: 'tencent.smartbox',
    })
  }

  return dedupeCandidates(candidates)
}

function dedupeCandidates(candidates: ExternalCandidate[]) {
  const seen = new Set<string>()
  const deduped: ExternalCandidate[] = []
  for (const candidate of candidates) {
    const key = `${candidate.market}:${candidate.code}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(candidate)
  }
  return deduped
}

function inferCandidatesFromCode(query: string): ExternalCandidate[] {
  const code = detectStockCode(query)
  if (!code) return []

  const upper = code.toUpperCase()
  if (/^\d{6}$/.test(upper)) {
    return [{ code: upper, name: upper, market: 'A', confidence: 0.72, source: 'code.inference' }]
  }
  if (/^\d{5}$/.test(upper)) {
    return [{ code: upper, name: upper, market: 'HK', confidence: 0.72, source: 'code.inference' }]
  }
  if (/^[A-Z]{1,6}$/.test(upper)) {
    return [{ code: upper, name: upper, market: 'US', confidence: 0.72, source: 'code.inference' }]
  }
  return []
}

export async function resolveExternalCandidates(query: string, limit = 5): Promise<ExternalCandidate[]> {
  const exactCode = inferCandidatesFromCode(query)
  if (exactCode.length && /^[A-Z]{1,6}$|^\d{5,6}(?:\.(?:SH|SZ|BJ|HK))?$/i.test(query.trim())) {
    return exactCode.slice(0, limit)
  }

  const queries = buildGenericSearchQueries(query)
  if (!queries.length) return exactCode.slice(0, limit)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)
  try {
    for (const candidateQuery of queries) {
      const response = await fetch(`https://smartbox.gtimg.cn/s3/?t=all&q=${encodeURIComponent(candidateQuery)}`, {
        signal: controller.signal,
        headers: {
          Accept: 'text/plain,*/*',
          'User-Agent': 'StockTracker/1.0',
        },
      })
      if (!response.ok) continue
      const raw = await response.text()
      const candidates = parseTencentSmartboxCandidates(raw, candidateQuery)
      if (candidates.length) return candidates.slice(0, limit)
    }
    return exactCode.slice(0, limit)
  } catch {
    return exactCode.slice(0, limit)
  } finally {
    clearTimeout(timeout)
  }
}

export function inferMarketCandidatesFromCode(query: string): ExternalCandidate[] {
  const code = detectStockCode(query)
  if (!code) return []
  const upper = code.toUpperCase()

  if (/^\d{5,6}$/.test(upper)) {
    return MARKET_OPTIONS.map((market) => ({
      code: upper,
      name: upper,
      market,
      confidence: market === 'A' ? 0.65 : 0.35,
      source: 'code.inference',
    }))
  }

  return MARKET_OPTIONS.map((market) => ({
    code: upper,
    name: upper,
    market,
    confidence: market === 'US' ? 0.65 : 0.35,
    source: 'code.inference',
  }))
}
