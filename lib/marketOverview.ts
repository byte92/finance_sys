import { createHash } from 'node:crypto'
import { buildAnalysisSystemPrompt, MARKET_ANALYSIS_PROMPT } from '@/lib/agent/prompts/analysis'
import { runMarketAnalysisAgentTask } from '@/lib/agent/tasks/analysis'
import { fetchStockNews } from '@/lib/external/news'
import { callJsonCompletion } from '@/lib/external/llmProvider'
import { MARKET_INDEX_DEFINITIONS, fetchMarketIndexSnapshot } from '@/lib/external/marketIndices'
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
  summary: {
    marketTone: string
    riskBias: string
    focusRegion: string
    cautionRegion: string
  }
  news: NewsItem[]
  updatedAt: string
}

export type MarketAnalysisContext = {
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

type MarketFallbackProbabilityInput = {
  bias: 'bullish' | 'neutral' | 'bearish'
  confidence: AiConfidence
  note: string
}

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

async function callProvider(config: AiConfig, systemPrompt: string, userPrompt: string) {
  return callJsonCompletion(config, systemPrompt, userPrompt)
}

function extractJsonBlock(content: string) {
  if (!content.trim()) return ''
  const fenced = content.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const objectMatch = content.match(/\{[\s\S]*\}/)
  return objectMatch?.[0]?.trim() ?? content.trim()
}

function safeParseJsonObject<T>(raw: string): T | null {
  const candidate = extractJsonBlock(raw)
  if (!candidate) return null

  try {
    return JSON.parse(candidate) as T
  } catch {
    const repaired = candidate
      .replace(/^[^{]*/, '')
      .replace(/[^}]*$/, '')
      .trim()
    if (!repaired) return null
    try {
      return JSON.parse(repaired) as T
    } catch {
      console.warn('[market-ai] failed to parse model JSON response', raw.slice(0, 500))
      return null
    }
  }
}

function buildFallbackProbability({ bias, confidence, note }: MarketFallbackProbabilityInput): AiProbabilityScenario[] {
  const templates = bias === 'bullish'
    ? { up: 52, flat: 28, down: 20 }
    : bias === 'bearish'
      ? { up: 18, flat: 30, down: 52 }
      : confidence === 'low'
        ? { up: 30, flat: 40, down: 30 }
        : { up: 34, flat: 38, down: 28 }

  return [
    {
      label: '上涨',
      probability: templates.up,
      rationale: bias === 'bullish'
        ? `当前风险偏好更偏向延续，前提是 ${note}。`
        : `当前没有足够证据支持全面走强，除非 ${note}。`,
    },
    {
      label: '震荡',
      probability: templates.flat,
      rationale: bias === 'neutral'
        ? `当前更像分化与等待确认阶段，重点观察 ${note}。`
        : `即便市场已有方向倾向，也可能先通过震荡完成消化，重点看 ${note}。`,
    },
    {
      label: '下跌',
      probability: templates.down,
      rationale: bias === 'bearish'
        ? `当前下行或防守压力更大，若 ${note} 迟迟不改善，弱势更可能延续。`
        : `若 ${note} 被证伪，防守压力会明显抬升。`,
    },
  ]
}

function inferMarketFallback(context: MarketAnalysisContext): MarketFallbackProbabilityInput {
  const spread = context.totalUpCount - context.totalDownCount
  const strongest = context.strongestIndex?.changePercent ?? 0
  const weakest = context.weakestIndex?.changePercent ?? 0
  const bias: MarketFallbackProbabilityInput['bias'] =
    spread >= 2 && strongest > Math.abs(weakest) ? 'bullish'
      : spread <= -2 || Math.abs(weakest) > strongest + 1 ? 'bearish'
        : 'neutral'
  const confidence: AiConfidence = context.news.length > 0 ? 'medium' : 'low'
  return {
    bias,
    confidence,
    note: '三地强弱排序是否继续维持，以及最强市场能否继续扩散带动风险偏好',
  }
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
  const fallbackInput = { bias: 'neutral' as const, confidence: 'medium' as const, note: '三地强弱排序与风险偏好是否继续延续' }
  const probabilityAssessment = parsed?.probabilityAssessment?.length ? parsed.probabilityAssessment : buildFallbackProbability(fallbackInput)
  return {
    generatedAt: new Date().toISOString(),
    cached: false,
    analysisStrength: 'high',
    summary,
    stance: parsed?.stance?.trim() || '中性偏观察',
    facts: parsed?.facts?.length ? parsed.facts : fallback.evidence,
    inferences: parsed?.inferences?.length ? parsed.inferences : [summary],
    actionPlan: parsed?.actionPlan?.length ? parsed.actionPlan : ['优先把大盘分析作为节奏参考，再结合个股和仓位做决策。'],
    invalidationSignals: parsed?.invalidationSignals?.length
      ? parsed.invalidationSignals
      : ['若三地指数强弱排序明显反转，或宏观新闻快速转向，应重新评估当前大盘判断。'],
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
    confidence: parsed?.confidence ?? fallbackInput.confidence,
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

function marketPrompt(context: MarketAnalysisContext, config: AiConfig) {
  return {
    system: buildAnalysisSystemPrompt(config.analysisLanguage, MARKET_ANALYSIS_PROMPT),
    user: JSON.stringify({
      task: '请对当前 A 股、港股和美股大盘做短中期分析，结合指数涨跌结构、技术指标和近期新闻，输出更有指导性的结构化观察建议。',
      intensity: 'high',
      horizons: {
        short: '1-5 个交易日',
        medium: '1-4 周',
      },
      outputRules: [
        '必须先判断市场强弱，再解释依据。',
        '必须区分事实与推断。',
        '必须给出概率分析，且概率总和为 100。',
        '高强度模式下可以给更直接的节奏倾向，但不能承诺收益。',
        '必须明确回答当前更适合偏进攻还是偏防守，以及现在不适合做什么。',
        '不能只写“关注节奏变化”，必须指出最值得优先观察的市场和触发条件。',
      ],
      context,
      outputContract: {
        analysisStrength: 'high|medium|weak',
        summary: 'string',
        stance: 'string',
        facts: ['string'],
        inferences: ['string'],
        actionPlan: ['string'],
        invalidationSignals: ['string'],
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
  const totalUpCount = snapshots.filter((item) => item.change > 0).length
  const totalDownCount = snapshots.filter((item) => item.change < 0).length
  const totalFlatCount = snapshots.filter((item) => item.change === 0).length
  const benchmarkDefs = MARKET_INDEX_DEFINITIONS.filter((item) =>
    ['shanghai-composite', 'hang-seng', 'dow-jones'].includes(item.id),
  )
  const news = (await Promise.all(
    benchmarkDefs.map((definition) => fetchStockNews(definition.code, definition.name, definition.market, 2)),
  )).flat().slice(0, 6)

  const focusRegion = groups
    .filter((group) => group.indices.length > 0)
    .sort((left, right) => {
      const leftStrength = left.strongestIndex?.changePercent ?? -999
      const rightStrength = right.strongestIndex?.changePercent ?? -999
      return rightStrength - leftStrength
    })[0] ?? null
  const cautionRegion = groups
    .filter((group) => group.indices.length > 0)
    .sort((left, right) => {
      const leftWeakness = left.weakestIndex?.changePercent ?? 999
      const rightWeakness = right.weakestIndex?.changePercent ?? 999
      return leftWeakness - rightWeakness
    })[0] ?? null
  const riskBias = totalUpCount > totalDownCount
    ? '当前风险偏好略偏正面，但仍需提防强弱分化。'
    : totalUpCount < totalDownCount
      ? '当前市场更偏防守，适合先看弱势是否继续扩散。'
      : '当前三地市场分化明显，整体更像等待确认。'
  const marketTone = strongestIndex && weakestIndex
    ? `当前最强指数是 ${strongestIndex.name}，最弱指数是 ${weakestIndex.name}，市场节奏以分化为主。`
    : '当前市场节奏以观察三地强弱轮动为主。'

  return {
    groups,
    totalUpCount,
    totalDownCount,
    totalFlatCount,
    strongestIndex,
    weakestIndex,
    summary: {
      marketTone,
      riskBias,
      focusRegion: focusRegion ? `${focusRegion.label} 相对更强，更值得优先跟踪。` : '暂无明确的领先市场。',
      cautionRegion: cautionRegion ? `${cautionRegion.label} 当前更弱，需要优先防范拖累效应。` : '暂无明确的弱势市场。',
    },
    news,
    updatedAt: new Date().toISOString(),
  }
}

export async function buildMarketAnalysisContextFromSources(aiConfig: AiConfig): Promise<{ context: MarketAnalysisContext; indices: MarketIndexSnapshot[]; news: NewsItem[] }> {
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

  return {
    context: buildMarketAnalysisContext(indices, news),
    indices,
    news,
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

  const task = await runMarketAnalysisAgentTask(aiConfig)
  const { context, indices, news } = task.context
  const { system, user } = marketPrompt(context, aiConfig)
  const raw = await callProvider(aiConfig, system, user)
  const parsed = safeParseJsonObject<Partial<AiAnalysisResult>>(raw)

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
  if (!parsed?.probabilityAssessment?.length) {
    const inferred = inferMarketFallback(context)
    result.probabilityAssessment = buildFallbackProbability(inferred)
    result.confidence = parsed?.confidence ?? inferred.confidence
  }

  setCachedMarketAnalysis(cacheKey, result, 900)
  return result
}

export function buildAnalysisTags(
  type: AiAnalysisHistoryRecord['type'],
  confidence: AiConfidence,
  _strength: AiAnalysisResult['analysisStrength'],
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
