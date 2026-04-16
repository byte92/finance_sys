import { createHash } from 'node:crypto'
import { buildTechnicalIndicatorSnapshot, type CandlePoint } from '@/lib/technicalIndicators'
import { fetchStockNews } from '@/lib/ai/service'
import type {
  AiAnalysisHistoryRecord,
  AiAnalysisResult,
  AiConfig,
  AiConfidence,
  AiNewsDriver,
  AiProbabilityScenario,
  AiTechnicalSignal,
  MarketIndexSnapshot,
  MarketRegion,
  NewsItem,
  TechnicalIndicatorSnapshot,
} from '@/types'
import type { Market } from '@/types'

const MARKET_ANALYSIS_CACHE = new Map<string, { expiresAt: number; result: AiAnalysisResult }>()

type MarketIndexDefinition = {
  id: string
  code: string
  name: string
  region: MarketRegion
  market: Market
  tencentCode: string
}

type MarketGroup = {
  region: MarketRegion
  label: string
  indices: MarketIndexSnapshot[]
  upCount: number
  downCount: number
  flatCount: number
  strongestIndex: MarketIndexSnapshot | null
  weakestIndex: MarketIndexSnapshot | null
}

type MarketOverview = {
  groups: MarketGroup[]
  totalUpCount: number
  totalDownCount: number
  totalFlatCount: number
  strongestIndex: MarketIndexSnapshot | null
  weakestIndex: MarketIndexSnapshot | null
  updatedAt: string
}

type MarketAnalysisContext = {
  groups: Array<{
    region: MarketRegion
    label: string
    upCount: number
    downCount: number
    flatCount: number
    indices: Array<{
      code: string
      name: string
      price: number
      change: number
      changePercent: number
      trendBias: TechnicalIndicatorSnapshot['trendBias'] | 'unknown'
      rsi14: number | null
      macdHistogram: number | null
      supportLevel: number | null
      resistanceLevel: number | null
    }>
  }>
  strongestIndex: { name: string; changePercent: number } | null
  weakestIndex: { name: string; changePercent: number } | null
  totalUpCount: number
  totalDownCount: number
  totalFlatCount: number
  news: NewsItem[]
}

const MARKET_INDEX_DEFINITIONS: MarketIndexDefinition[] = [
  { id: 'shanghai-composite', code: '000001', name: '上证指数', region: 'A', market: 'A', tencentCode: 'sh000001' },
  { id: 'shenzhen-component', code: '399001', name: '深证成指', region: 'A', market: 'A', tencentCode: 'sz399001' },
  { id: 'chinext', code: '399006', name: '创业板指', region: 'A', market: 'A', tencentCode: 'sz399006' },
  { id: 'hang-seng', code: 'HSI', name: '恒生指数', region: 'HK', market: 'HK', tencentCode: 'hkHSI' },
  { id: 'hang-seng-tech', code: 'HSTECH', name: '恒生科技指数', region: 'HK', market: 'HK', tencentCode: 'hkHSTECH' },
  { id: 'dow-jones', code: 'DJI', name: '道琼斯', region: 'US', market: 'US', tencentCode: 'usDJI' },
  { id: 'sp500', code: 'SPX', name: '标普500', region: 'US', market: 'US', tencentCode: 'usINX' },
  { id: 'nasdaq', code: 'IXIC', name: '纳斯达克', region: 'US', market: 'US', tencentCode: 'usIXIC' },
]

const GROUP_LABELS: Record<MarketRegion, string> = {
  A: 'A 股大盘',
  HK: '港股大盘',
  US: '美股大盘',
}

function getMarketCacheKey(prefix: string, payload: unknown) {
  return `${prefix}:${createHash('sha1').update(JSON.stringify(payload)).digest('hex')}`
}

function getCachedMarketAnalysis(key: string) {
  const cached = MARKET_ANALYSIS_CACHE.get(key)
  if (!cached) return null
  if (Date.now() > cached.expiresAt) {
    MARKET_ANALYSIS_CACHE.delete(key)
    return null
  }
  return cached.result
}

function setCachedMarketAnalysis(key: string, result: AiAnalysisResult, ttlSeconds: number) {
  MARKET_ANALYSIS_CACHE.set(key, {
    result: { ...result, cached: true },
    expiresAt: Date.now() + ttlSeconds * 1000,
  })
}

function validateAiConfig(config: AiConfig) {
  if (!config.enabled) throw new Error('AI 功能尚未启用')
  if (!config.baseUrl.trim()) throw new Error('请先配置 AI Base URL')
  if (!config.model.trim()) throw new Error('请先配置 AI 模型')
  if (!config.apiKey.trim()) throw new Error('请先配置 AI API Key')
}

function ensureApiBase(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, '')
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

async function callProvider(config: AiConfig, systemPrompt: string, userPrompt: string) {
  if (config.provider === 'anthropic-compatible') {
    const baseUrl = ensureApiBase(config.baseUrl)
    const res = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        system: systemPrompt,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`)
    }

    const payload = await res.json()
    const contentBlocks = payload?.content
    if (!Array.isArray(contentBlocks)) {
      throw new Error('Anthropic 响应格式无效')
    }
    const text = contentBlocks
      .map((block) => (block?.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim()

    if (!text) {
      throw new Error('LLM 未返回有效内容')
    }
    return text
  }

  const baseUrl = ensureApiBase(config.baseUrl)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`)
  }

  const payload = await res.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LLM 未返回有效内容')
  }
  return content
}

function extractJsonBlock(content: string) {
  const fenced = content.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const objectMatch = content.match(/\{[\s\S]*\}/)
  return objectMatch?.[0]?.trim() ?? content.trim()
}

function buildFallbackProbability(summary: string): AiProbabilityScenario[] {
  return [
    { label: '上涨', probability: 34, rationale: `${summary}，但仍要等待更多确认信号。` },
    { label: '震荡', probability: 41, rationale: '当前更适合视为震荡消化阶段，而非单边趋势。' },
    { label: '下跌', probability: 25, rationale: '若关键支撑失守或宏观利空扩散，下行压力会升高。' },
  ]
}

function normalizeMarketAnalysisResult(
  parsed: Partial<AiAnalysisResult> | null,
  fallback: {
    summary: string
    evidence: string[]
    signals?: AiTechnicalSignal[]
    news?: AiNewsDriver[]
  },
): AiAnalysisResult {
  const summary = parsed?.summary?.trim() || fallback.summary
  const probabilityAssessment = parsed?.probabilityAssessment?.length ? parsed.probabilityAssessment : buildFallbackProbability(summary)
  return {
    generatedAt: new Date().toISOString(),
    cached: false,
    summary,
    stance: parsed?.stance?.trim() || '中性偏观察',
    timeHorizons: parsed?.timeHorizons?.length ? parsed.timeHorizons : [
      { horizon: 'short', summary: '未来 1-5 个交易日重点观察指数强弱分化与量价配合。', scenarios: probabilityAssessment },
      { horizon: 'medium', summary: '未来 1-4 周重点观察趋势延续、政策预期和新闻兑现。', scenarios: probabilityAssessment },
    ],
    probabilityAssessment,
    technicalSignals: parsed?.technicalSignals?.length ? parsed.technicalSignals : (fallback.signals ?? []),
    newsDrivers: parsed?.newsDrivers?.length ? parsed.newsDrivers : (fallback.news ?? []),
    keyLevels: parsed?.keyLevels?.length ? parsed.keyLevels : ['关注三地大盘代表指数的近期支撑与阻力位'],
    actionableObservations: parsed?.actionableObservations?.length ? parsed.actionableObservations : ['把大盘分析作为节奏参考，仍需结合个股与仓位管理。'],
    risks: parsed?.risks?.length ? parsed.risks : ['外部指数、新闻和技术指标数据可能延迟或缺失。'],
    confidence: parsed?.confidence ?? 'medium',
    disclaimer: parsed?.disclaimer?.trim() || '以上内容仅基于当前大盘数据进行条件式分析，不构成投资建议或收益承诺。',
    evidence: parsed?.evidence?.length ? parsed.evidence : fallback.evidence,
  }
}

function mapMarketSignals(snapshots: MarketIndexSnapshot[]): AiTechnicalSignal[] {
  return snapshots.slice(0, 6).map((item) => ({
    name: item.name,
    value: `${item.price.toFixed(2)} / ${item.changePercent.toFixed(2)}%`,
    interpretation: item.indicators
      ? `趋势 ${item.indicators.trendBias}，RSI ${item.indicators.rsi14?.toFixed(1) ?? '--'}`
      : '暂无完整技术指标',
  }))
}

function toAiNewsDrivers(news: NewsItem[]): AiNewsDriver[] {
  return news.map((item) => ({
    headline: item.title,
    source: item.source,
    publishedAt: item.publishedAt,
    sentiment: 'neutral',
    impact: item.summary || '关注新闻对指数情绪和风格切换的影响。',
    url: item.url,
  }))
}

function marketPrompt(context: MarketAnalysisContext, language: string) {
  return {
    system: `你是一名谨慎的全球市场观察助手。请基于提供的数据输出严格 JSON，不要输出 Markdown，不要编造未提供的事实。必须区分事实和推断，要给出概率分析，但不能承诺收益。输出语言使用 ${language}。`,
    user: JSON.stringify({
      task: '请对当前 A 股、港股和美股大盘做短中期分析，结合指数涨跌结构、技术指标和近期新闻，输出结构化观察建议。',
      horizons: {
        short: '1-5 个交易日',
        medium: '1-4 周',
      },
      context,
      outputContract: {
        summary: 'string',
        stance: 'string',
        timeHorizons: [{ horizon: 'short|medium', summary: 'string', scenarios: [{ label: 'string', probability: 'number', rationale: 'string' }] }],
        probabilityAssessment: [{ label: 'string', probability: 'number', rationale: 'string' }],
        technicalSignals: [{ name: 'string', value: 'string', interpretation: 'string' }],
        newsDrivers: [{ headline: 'string', source: 'string', publishedAt: 'string', sentiment: 'positive|neutral|negative', impact: 'string', url: 'string' }],
        keyLevels: ['string'],
        actionableObservations: ['string'],
        risks: ['string'],
        confidence: 'low|medium|high',
        evidence: ['string'],
        disclaimer: 'string',
      },
    }),
  }
}

function parseDateString(date: string, market: Market) {
  if (market === 'US') {
    return `${date}T00:00:00Z`
  }
  return `${date}T00:00:00+08:00`
}

function parseCandleRows(rows: string[][], market: Market): CandlePoint[] {
  return rows
    .map((row) => {
      const date = row?.[0]
      const open = Number(row?.[1])
      const close = Number(row?.[2])
      const high = Number(row?.[3])
      const low = Number(row?.[4])
      const volume = Number(row?.[5])
      if (!date || !Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(high) || !Number.isFinite(low)) {
        return null
      }
      return {
        date,
        time: Math.floor(Date.parse(parseDateString(date, market)) / 1000),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      }
    })
    .filter((item): item is CandlePoint => item !== null)
}

async function fetchIndexRawPayload(definition: MarketIndexDefinition, limit = 120) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${definition.tencentCode},day,,,${limit},qfq`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(7000),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`获取 ${definition.name} 数据失败`)
  }
  const data = await res.json()
  return data?.data?.[definition.tencentCode] ?? null
}

async function fetchMarketIndexSnapshot(definition: MarketIndexDefinition, options: { includeIndicators?: boolean } = {}): Promise<MarketIndexSnapshot | null> {
  try {
    const raw = await fetchIndexRawPayload(definition, options.includeIndicators ? 240 : 2)
    if (!raw) return null

    const rows = (raw.qfqday ?? raw.day ?? []) as string[][]
    const candles = parseCandleRows(rows, definition.market)
    const latest = candles[candles.length - 1]
    const previous = candles[candles.length - 2] ?? null
    const qt = (raw.qt?.[definition.tencentCode] ?? null) as string[] | null

    const price = Number(qt?.[3] ?? latest?.close)
    const previousClose = Number(qt?.[4] ?? previous?.close ?? 0)
    const open = Number(qt?.[5] ?? latest?.open ?? 0)
    const high = Number(qt?.[34] ?? latest?.high ?? 0)
    const low = Number(qt?.[35] ?? latest?.low ?? 0)
    const volume = Number(qt?.[6] ?? latest?.volume ?? 0)
    const change = Number.isFinite(Number(qt?.[32])) ? Number(qt?.[32]) : price - previousClose
    const changePercent = Number.isFinite(Number(qt?.[33])) ? Number(qt?.[33]) : (previousClose > 0 ? (change / previousClose) * 100 : 0)
    const timestamp = qt?.[30] && qt?.[31]
      ? `${String(qt[30]).replace(/\//g, '-')}T${String(qt[31]).slice(0, 2)}:${String(qt[31]).slice(2, 4)}:${String(qt[31]).slice(4, 6)}${definition.market === 'US' ? 'Z' : '+08:00'}`
      : new Date().toISOString()

    if (!Number.isFinite(price) || price <= 0) {
      return null
    }

    return {
      id: definition.id,
      code: definition.code,
      name: String(qt?.[1] ?? definition.name),
      region: definition.region,
      market: definition.market,
      price,
      change,
      changePercent,
      previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null,
      open: Number.isFinite(open) && open > 0 ? open : null,
      high: Number.isFinite(high) && high > 0 ? high : null,
      low: Number.isFinite(low) && low > 0 ? low : null,
      volume: Number.isFinite(volume) && volume > 0 ? volume : null,
      timestamp,
      currency: definition.market === 'US' ? 'USD' : definition.market === 'HK' ? 'HKD' : 'CNY',
      source: 'tencent',
      indicators: options.includeIndicators ? buildTechnicalIndicatorSnapshot(candles) : undefined,
    }
  } catch (error) {
    console.error(`[marketOverview] Failed to fetch ${definition.name}:`, error)
    return null
  }
}

export async function fetchMarketOverview(): Promise<MarketOverview> {
  const snapshots = (await Promise.all(MARKET_INDEX_DEFINITIONS.map((definition) => fetchMarketIndexSnapshot(definition))))
    .filter((item): item is MarketIndexSnapshot => item !== null)

  const groups = (['A', 'HK', 'US'] as const).map((region) => {
    const indices = snapshots.filter((item) => item.region === region)
    return {
      region,
      label: GROUP_LABELS[region],
      indices,
      upCount: indices.filter((item) => item.change > 0).length,
      downCount: indices.filter((item) => item.change < 0).length,
      flatCount: indices.filter((item) => item.change === 0).length,
      strongestIndex: indices.length > 0
        ? [...indices].sort((left, right) => right.changePercent - left.changePercent)[0] ?? null
        : null,
      weakestIndex: indices.length > 0
        ? [...indices].sort((left, right) => left.changePercent - right.changePercent)[0] ?? null
        : null,
    }
  })

  const strongestIndex = snapshots.length > 0
    ? [...snapshots].sort((left, right) => right.changePercent - left.changePercent)[0] ?? null
    : null
  const weakestIndex = snapshots.length > 0
    ? [...snapshots].sort((left, right) => left.changePercent - right.changePercent)[0] ?? null
    : null

  return {
    groups,
    totalUpCount: snapshots.filter((item) => item.change > 0).length,
    totalDownCount: snapshots.filter((item) => item.change < 0).length,
    totalFlatCount: snapshots.filter((item) => item.change === 0).length,
    strongestIndex,
    weakestIndex,
    updatedAt: new Date().toISOString(),
  }
}

function buildMarketAnalysisContext(indices: MarketIndexSnapshot[], news: NewsItem[]): MarketAnalysisContext {
  const groups = (['A', 'HK', 'US'] as const).map((region) => {
    const regionIndices = indices.filter((item) => item.region === region)
    return {
      region,
      label: GROUP_LABELS[region],
      upCount: regionIndices.filter((item) => item.change > 0).length,
      downCount: regionIndices.filter((item) => item.change < 0).length,
      flatCount: regionIndices.filter((item) => item.change === 0).length,
      indices: regionIndices.map((item) => ({
        code: item.code,
        name: item.name,
        price: item.price,
        change: item.change,
        changePercent: item.changePercent,
        trendBias: (item.indicators?.trendBias ?? 'unknown') as TechnicalIndicatorSnapshot['trendBias'] | 'unknown',
        rsi14: item.indicators?.rsi14 ?? null,
        macdHistogram: item.indicators?.macd.histogram ?? null,
        supportLevel: item.indicators?.supportLevel ?? null,
        resistanceLevel: item.indicators?.resistanceLevel ?? null,
      })),
    }
  })

  const strongest = indices.length > 0
    ? [...indices].sort((left, right) => right.changePercent - left.changePercent)[0]
    : null
  const weakest = indices.length > 0
    ? [...indices].sort((left, right) => left.changePercent - right.changePercent)[0]
    : null

  return {
    groups,
    strongestIndex: strongest ? { name: strongest.name, changePercent: strongest.changePercent } : null,
    weakestIndex: weakest ? { name: weakest.name, changePercent: weakest.changePercent } : null,
    totalUpCount: indices.filter((item) => item.change > 0).length,
    totalDownCount: indices.filter((item) => item.change < 0).length,
    totalFlatCount: indices.filter((item) => item.change === 0).length,
    news,
  }
}

export async function generateMarketAnalysis(aiConfig: AiConfig, forceRefresh = false): Promise<AiAnalysisResult> {
  validateAiConfig(aiConfig)

  const cacheKey = getMarketCacheKey('market', {
    aiConfig: { ...aiConfig, apiKey: '***' },
    date: new Date().toISOString().slice(0, 10),
  })

  if (!forceRefresh) {
    const cached = getCachedMarketAnalysis(cacheKey)
    if (cached) return cached
  }

  const indices = (await Promise.all(
    MARKET_INDEX_DEFINITIONS.map((definition) => fetchMarketIndexSnapshot(definition, { includeIndicators: true })),
  )).filter((item): item is MarketIndexSnapshot => item !== null)

  const benchmarkDefs = MARKET_INDEX_DEFINITIONS.filter((item) =>
    ['shanghai-composite', 'hang-seng', 'dow-jones'].includes(item.id),
  )
  const news = aiConfig.newsEnabled
    ? (await Promise.all(
        benchmarkDefs.map((definition) => fetchStockNews(definition.code, definition.name, definition.market, 3)),
      )).flat()
    : []

  const context = buildMarketAnalysisContext(indices, news)
  const { system, user } = marketPrompt(context, aiConfig.analysisLanguage)
  const raw = await callProvider(aiConfig, system, user)

  let parsed: Partial<AiAnalysisResult> | null = null
  try {
    parsed = JSON.parse(extractJsonBlock(raw)) as Partial<AiAnalysisResult>
  } catch {
    parsed = null
  }

  const result = normalizeMarketAnalysisResult(parsed, {
    summary: `当前三地大盘共 ${indices.length} 个代表指数，短线更适合先观察强弱分化和风格切换，而不是单边预设。`,
    evidence: [
      `上涨指数 ${context.totalUpCount} 个`,
      `下跌指数 ${context.totalDownCount} 个`,
      context.strongestIndex ? `最强指数 ${context.strongestIndex.name} ${context.strongestIndex.changePercent.toFixed(2)}%` : '暂无最强指数结论',
      context.weakestIndex ? `最弱指数 ${context.weakestIndex.name} ${context.weakestIndex.changePercent.toFixed(2)}%` : '暂无最弱指数结论',
    ],
    signals: mapMarketSignals(indices),
    news: toAiNewsDrivers(news),
  })

  setCachedMarketAnalysis(cacheKey, result, 900)
  return result
}

export function buildAnalysisTags(
  type: AiAnalysisHistoryRecord['type'],
  confidence: AiConfidence,
  stock?: { market: Market; code: string; name: string },
) {
  const typeLabel = type === 'portfolio' ? '组合分析' : type === 'market' ? '大盘分析' : '个股分析'
  const tags = [
    typeLabel,
    confidence === 'high' ? '高信心' : confidence === 'medium' ? '中等信心' : '低信心',
  ]
  if (stock) {
    tags.push(stock.code, stock.market, stock.name)
  } else if (type === 'market') {
    tags.push('A股', '港股', '美股')
  }
  return tags
}
