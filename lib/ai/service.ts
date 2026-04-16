import { createHash } from 'node:crypto'
import { calcStockSummary } from '@/lib/finance'
import { stockPriceService } from '@/lib/StockPriceService'
import { buildTechnicalIndicatorSnapshot, type CandlePoint } from '@/lib/technicalIndicators'
import type {
  AiAnalysisHistoryRecord,
  AiAnalysisResult,
  AiConfig,
  AiConfidence,
  AiNewsDriver,
  AiProbabilityScenario,
  AiTechnicalSignal,
  NewsItem,
  Stock,
  TechnicalIndicatorSnapshot,
} from '@/types'
import type { Market } from '@/types'

const ANALYSIS_CACHE = new Map<string, { expiresAt: number; result: AiAnalysisResult }>()

type PortfolioAnalysisContext = {
  summaries: Array<{
    id: string
    code: string
    name: string
    market: Market
    currentHolding: number
    avgCostPrice: number
    realizedPnl: number
    unrealizedPnl: number
    totalPnl: number
    totalBuyAmount: number
    totalCommission: number
    totalDividend: number
    holdingWeight: number
    currentPrice: number | null
    changePercent: number | null
  }>
  totalInvested: number
  totalRealizedPnl: number
  totalUnrealizedPnl: number
  largestPositionWeight: number
  profitableCount: number
  losingCount: number
}

type StockAnalysisContext = {
  stock: Stock
  summary: ReturnType<typeof calcStockSummary>
  quote: Awaited<ReturnType<typeof stockPriceService.getQuote>>
  indicators: TechnicalIndicatorSnapshot | null
  news: NewsItem[]
}

function getCacheKey(prefix: string, payload: unknown) {
  return `${prefix}:${createHash('sha1').update(JSON.stringify(payload)).digest('hex')}`
}

function getCachedAnalysis(key: string) {
  const cached = ANALYSIS_CACHE.get(key)
  if (!cached) return null
  if (Date.now() > cached.expiresAt) {
    ANALYSIS_CACHE.delete(key)
    return null
  }
  return cached.result
}

function setCachedAnalysis(key: string, result: AiAnalysisResult, ttlSeconds: number) {
  ANALYSIS_CACHE.set(key, {
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

function ensureApiBase(baseUrl: string, mode: 'openai' | 'anthropic') {
  const normalized = baseUrl.replace(/\/$/, '')
  if (mode === 'openai') {
    return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
  }
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

async function fetchDailyCandles(symbol: string, market: Market): Promise<CandlePoint[]> {
  if (market === 'US') {
    const std = `${symbol.trim().toLowerCase()}.us`
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(std)}&i=d`
    const res = await fetch(url, { signal: AbortSignal.timeout(7000), cache: 'no-store' })
    if (!res.ok) return []
    const text = await res.text()
    const lines = text.trim().split('\n').slice(1)
    return lines
      .map((line) => {
        const [date, openS, highS, lowS, closeS, volS] = line.split(',')
        const open = Number(openS)
        const high = Number(highS)
        const low = Number(lowS)
        const close = Number(closeS)
        const volume = Number(volS)
        if (!date || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
          return null
        }
        return {
          date: date.slice(0, 10),
          time: Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000),
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) ? volume : 0,
        }
      })
      .filter((item): item is CandlePoint => item !== null)
      .slice(-240)
  }

  const code = toTencentCode(symbol, market)
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,240,qfq`
  const res = await fetch(url, { signal: AbortSignal.timeout(7000), cache: 'no-store' })
  if (!res.ok) return []
  const data = await res.json()
  const rows = (data?.data?.[code]?.qfqday ?? data?.data?.[code]?.day ?? []) as string[][]
  return rows
    .map((row) => {
      const date = row?.[0]
      const open = Number(row?.[1])
      const close = Number(row?.[2])
      const high = Number(row?.[3])
      const low = Number(row?.[4])
      const volume = Number(row?.[5])
      if (!date || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
        return null
      }
      return {
        date: date.slice(0, 10),
        time: Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00+08:00`) / 1000),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      }
    })
    .filter((item): item is CandlePoint => item !== null)
}

function toTencentCode(code: string, market: Market) {
  if (market === 'HK') return `hk${code.padStart(5, '0')}`
  if (market === 'A' || market === 'FUND') {
    return code.startsWith('6') || code.startsWith('5') ? `sh${code}` : `sz${code}`
  }
  return code
}

export async function fetchStockNews(symbol: string, stockName: string, market: Market, limit = 5): Promise<NewsItem[]> {
  const queryParts = [stockName, symbol]
  if (market === 'A' || market === 'FUND') queryParts.push('A股')
  if (market === 'HK') queryParts.push('港股')
  if (market === 'US') queryParts.push('美股')
  const query = queryParts.join(' ')
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(7000), cache: 'no-store' })
    if (!res.ok) return []
    const xml = await res.text()
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))
      .map((match) => match[1])
      .map((item) => ({
        title: decodeXmlTag(item, 'title'),
        source: decodeXmlTag(item, 'source') || 'Google News',
        publishedAt: decodeXmlTag(item, 'pubDate'),
        summary: stripHtml(decodeXmlTag(item, 'description')).slice(0, 220),
        url: decodeXmlTag(item, 'link'),
      }))
      .filter((item) => item.title && item.url)

    const deduped = new Map<string, NewsItem>()
    for (const item of items) {
      if (!deduped.has(item.title)) deduped.set(item.title, item)
    }

    return Array.from(deduped.values()).slice(0, limit)
  } catch {
    return []
  }
}

function decodeXmlTag(xml: string, tag: string) {
  const direct = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (direct?.[1]) return decodeXmlEntities(direct[1]).trim()
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
  return decodeXmlEntities(cdata?.[1] ?? '').trim()
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  }

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildPortfolioContext(stocks: Stock[], quotes: Map<string, Awaited<ReturnType<typeof stockPriceService.getQuote>>>) {
  const summaries = stocks.map((stock) => {
    const quote = quotes.get(stock.id) ?? null
    const summary = calcStockSummary(stock, quote?.price)
    return {
      id: stock.id,
      code: stock.code,
      name: stock.name,
      market: stock.market,
      currentHolding: summary.currentHolding,
      avgCostPrice: summary.avgCostPrice,
      realizedPnl: summary.realizedPnl,
      unrealizedPnl: summary.unrealizedPnl,
      totalPnl: summary.totalPnl,
      totalBuyAmount: summary.totalBuyAmount,
      totalCommission: summary.totalCommission,
      totalDividend: summary.totalDividend,
      currentPrice: quote?.price ?? null,
      changePercent: quote?.changePercent ?? null,
      holdingWeight: 0,
    }
  })
  const totalInvested = summaries.reduce((sum, item) => sum + item.totalBuyAmount, 0)
  const enriched = summaries.map((item) => ({
    ...item,
    holdingWeight: totalInvested > 0 ? item.totalBuyAmount / totalInvested : 0,
  }))
  return {
    summaries: enriched,
    totalInvested,
    totalRealizedPnl: enriched.reduce((sum, item) => sum + item.realizedPnl, 0),
    totalUnrealizedPnl: enriched.reduce((sum, item) => sum + item.unrealizedPnl, 0),
    largestPositionWeight: enriched.reduce((max, item) => Math.max(max, item.holdingWeight), 0),
    profitableCount: enriched.filter((item) => item.totalPnl >= 0).length,
    losingCount: enriched.filter((item) => item.totalPnl < 0).length,
  } satisfies PortfolioAnalysisContext
}

function mapTechnicalSignals(snapshot: TechnicalIndicatorSnapshot | null): AiTechnicalSignal[] {
  if (!snapshot) return []
  return [
    { name: 'MA5/10/20', value: `${snapshot.ma5 ?? '--'} / ${snapshot.ma10 ?? '--'} / ${snapshot.ma20 ?? '--'}`, interpretation: `趋势偏向 ${snapshot.trendBias}` },
    { name: 'MACD', value: `${snapshot.macd.dif ?? '--'} / ${snapshot.macd.dea ?? '--'} / ${snapshot.macd.histogram ?? '--'}`, interpretation: snapshot.macd.histogram !== null && snapshot.macd.histogram >= 0 ? '动能偏强' : '动能偏弱' },
    { name: 'RSI14', value: `${snapshot.rsi14 ?? '--'}`, interpretation: snapshot.rsi14 !== null && snapshot.rsi14 > 70 ? '可能过热' : snapshot.rsi14 !== null && snapshot.rsi14 < 30 ? '可能超卖' : '中性区间' },
    { name: 'BOLL', value: `${snapshot.boll.lower ?? '--'} / ${snapshot.boll.middle ?? '--'} / ${snapshot.boll.upper ?? '--'}`, interpretation: '关注布林上下轨波动区间' },
  ]
}

function buildFallbackProbability(summary: string): AiProbabilityScenario[] {
  return [
    { label: '上涨', probability: 35, rationale: `${summary}，但仍需等待更多确认信号。` },
    { label: '震荡', probability: 40, rationale: '当前信息更支持波动与消化，而非单边行情。' },
    { label: '下跌', probability: 25, rationale: '若关键支撑失守或负面新闻扩散，下行概率会抬升。' },
  ]
}

function normalizeAnalysisResult(parsed: Partial<AiAnalysisResult> | null, fallback: { summary: string; evidence: string[]; signals?: AiTechnicalSignal[]; news?: AiNewsDriver[]; mode: 'portfolio' | 'stock' }): AiAnalysisResult {
  const summary = parsed?.summary?.trim() || fallback.summary
  const probabilityAssessment = parsed?.probabilityAssessment?.length ? parsed.probabilityAssessment : buildFallbackProbability(summary)
  return {
    generatedAt: new Date().toISOString(),
    cached: false,
    summary,
    stance: parsed?.stance?.trim() || '中性偏观察',
    timeHorizons: parsed?.timeHorizons?.length ? parsed.timeHorizons : [
      { horizon: 'short', summary: '未来 1-5 个交易日以观察关键价位与量能变化为主。', scenarios: probabilityAssessment },
      { horizon: 'medium', summary: '未来 1-4 周重点观察趋势延续与新闻兑现情况。', scenarios: probabilityAssessment },
    ],
    probabilityAssessment,
    technicalSignals: parsed?.technicalSignals?.length ? parsed.technicalSignals : (fallback.signals ?? []),
    newsDrivers: parsed?.newsDrivers?.length ? parsed.newsDrivers : (fallback.news ?? []),
    keyLevels: parsed?.keyLevels?.length ? parsed.keyLevels : ['关注近期支撑/阻力是否被有效突破'],
    positionAdvice: fallback.mode === 'stock' ? (parsed?.positionAdvice?.length ? parsed.positionAdvice : ['优先结合你的成本区与仓位控制节奏，不要把 AI 结论当作单一信号。']) : undefined,
    portfolioRiskNotes: fallback.mode === 'portfolio' ? (parsed?.portfolioRiskNotes?.length ? parsed.portfolioRiskNotes : ['优先留意单一标的过度集中和盈利回撤风险。']) : undefined,
    actionableObservations: parsed?.actionableObservations?.length ? parsed.actionableObservations : ['把 AI 结论作为复盘辅助，而不是独立交易依据。'],
    risks: parsed?.risks?.length ? parsed.risks : ['外部新闻、行情与估值数据可能延迟或缺失。'],
    confidence: parsed?.confidence ?? 'medium',
    disclaimer: parsed?.disclaimer?.trim() || '以上内容仅基于当前数据进行条件式分析，不构成投资建议或收益承诺。',
    evidence: parsed?.evidence?.length ? parsed.evidence : fallback.evidence,
  }
}

function extractJsonBlock(content: string) {
  const fenced = content.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const objectMatch = content.match(/\{[\s\S]*\}/)
  return objectMatch?.[0]?.trim() ?? content.trim()
}

async function callOpenAiCompatible(config: AiConfig, systemPrompt: string, userPrompt: string) {
  const baseUrl = ensureApiBase(config.baseUrl, 'openai')
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

async function callAnthropicCompatible(config: AiConfig, systemPrompt: string, userPrompt: string) {
  const baseUrl = ensureApiBase(config.baseUrl, 'anthropic')
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
      messages: [
        { role: 'user', content: userPrompt },
      ],
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

async function callProvider(config: AiConfig, systemPrompt: string, userPrompt: string) {
  if (config.provider === 'anthropic-compatible') {
    return callAnthropicCompatible(config, systemPrompt, userPrompt)
  }
  return callOpenAiCompatible(config, systemPrompt, userPrompt)
}

function portfolioPrompt(context: PortfolioAnalysisContext, language: string) {
  return {
    system: `你是一名谨慎的股票投研助手。请基于提供的数据输出严格 JSON，不要输出 Markdown，不要编造未提供的事实。必须区分“事实”和“推断”，不能承诺收益，不能使用绝对语气。输出语言使用 ${language}。`,
    user: JSON.stringify({
      task: '请对当前组合做短中期分析，重点关注仓位集中度、已实现/未实现盈亏结构、可能的风险暴露，并给出观察建议。',
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
        portfolioRiskNotes: ['string'],
        actionableObservations: ['string'],
        risks: ['string'],
        confidence: 'low|medium|high',
        evidence: ['string'],
        disclaimer: 'string',
      },
    }),
  }
}

function stockPrompt(context: StockAnalysisContext, language: string) {
  return {
    system: `你是一名谨慎的股票投研助手。请基于提供的数据输出严格 JSON，不要输出 Markdown，不要编造未提供的事实。请明确区分事实、信号与推断，必须给出概率分析，但不能承诺收益。输出语言使用 ${language}。`,
    user: JSON.stringify({
      task: '请对这只股票从持仓视角给出短中期分析，结合技术指标、持仓成本、盈亏状态与新闻驱动给出观察建议。',
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
        positionAdvice: ['string'],
        actionableObservations: ['string'],
        risks: ['string'],
        confidence: 'low|medium|high',
        evidence: ['string'],
        disclaimer: 'string',
      },
    }),
  }
}

function toAiNewsDrivers(news: NewsItem[]): AiNewsDriver[] {
  return news.map((item) => ({
    headline: item.title,
    source: item.source,
    publishedAt: item.publishedAt,
    sentiment: 'neutral',
    impact: item.summary || '关注新闻对短中期情绪的影响。',
    url: item.url,
  }))
}

export async function generatePortfolioAnalysis(stocks: Stock[], aiConfig: AiConfig, forceRefresh = false): Promise<AiAnalysisResult> {
  validateAiConfig(aiConfig)
  const cacheKey = getCacheKey('portfolio', {
    stocks: stocks.map((stock) => ({ id: stock.id, updatedAt: stock.updatedAt, trades: stock.trades.length })),
    aiConfig: { ...aiConfig, apiKey: '***' },
  })
  if (!forceRefresh) {
    const cached = getCachedAnalysis(cacheKey)
    if (cached) return cached
  }

  const quotes = new Map<string, Awaited<ReturnType<typeof stockPriceService.getQuote>>>()
  await Promise.all(stocks.map(async (stock) => {
    const quote = await stockPriceService.getQuote(stock.code, stock.market)
    quotes.set(stock.id, quote)
  }))

  const context = buildPortfolioContext(stocks, quotes)
  const { system, user } = portfolioPrompt(context, aiConfig.analysisLanguage)
  const raw = await callProvider(aiConfig, system, user)
  let parsed: Partial<AiAnalysisResult> | null = null
  try {
    parsed = JSON.parse(extractJsonBlock(raw)) as Partial<AiAnalysisResult>
  } catch {
    parsed = null
  }

  const result = normalizeAnalysisResult(parsed, {
    summary: `当前组合包含 ${context.summaries.length} 只资产，最大仓位占比约 ${(context.largestPositionWeight * 100).toFixed(1)}%，适合优先关注集中度和浮盈回撤。`,
    evidence: [
      `总投入约 ${context.totalInvested.toFixed(2)}`,
      `已实现收益约 ${context.totalRealizedPnl.toFixed(2)}`,
      `未实现盈亏约 ${context.totalUnrealizedPnl.toFixed(2)}`,
    ],
    mode: 'portfolio',
  })
  setCachedAnalysis(cacheKey, result, 900)
  return result
}

export async function generateStockAnalysis(stock: Stock, aiConfig: AiConfig, forceRefresh = false): Promise<AiAnalysisResult> {
  validateAiConfig(aiConfig)
  const cacheKey = getCacheKey('stock', {
    stock: { id: stock.id, updatedAt: stock.updatedAt, trades: stock.trades.length },
    aiConfig: { ...aiConfig, apiKey: '***' },
  })
  if (!forceRefresh) {
    const cached = getCachedAnalysis(cacheKey)
    if (cached) return cached
  }

  const quote = await stockPriceService.getQuote(stock.code, stock.market)
  const summary = calcStockSummary(stock, quote?.price)
  const candles = await fetchDailyCandles(stock.code, stock.market)
  const indicators = buildTechnicalIndicatorSnapshot(candles)
  const news = aiConfig.newsEnabled ? await fetchStockNews(stock.code, stock.name, stock.market) : []
  const context: StockAnalysisContext = { stock, summary, quote, indicators, news }

  const { system, user } = stockPrompt(context, aiConfig.analysisLanguage)
  const raw = await callProvider(aiConfig, system, user)
  let parsed: Partial<AiAnalysisResult> | null = null
  try {
    parsed = JSON.parse(extractJsonBlock(raw)) as Partial<AiAnalysisResult>
  } catch {
    parsed = null
  }

  const result = normalizeAnalysisResult(parsed, {
    summary: `${stock.name} 当前更适合结合持仓成本、关键价位与新闻变化做条件式观察，而不是单一信号决策。`,
    evidence: [
      `当前持仓 ${summary.currentHolding}`,
      `已实现收益 ${summary.realizedPnl.toFixed(2)}`,
      `当前价格 ${quote?.price ?? '暂无'}`,
      indicators ? `趋势偏向 ${indicators.trendBias}` : '暂无完整技术指标',
    ],
    signals: mapTechnicalSignals(indicators),
    news: toAiNewsDrivers(news),
    mode: 'stock',
  })
  setCachedAnalysis(cacheKey, result, 600)
  return result
}

export async function testAiConnection(config: AiConfig) {
  validateAiConfig(config)
  const raw = await callProvider(
    config,
    '你是一个只会返回 JSON 的连接测试助手。',
    JSON.stringify({
      task: '请返回一个 JSON 对象，包含 ok=true、provider、model、message。',
      provider: config.provider,
      model: config.model,
    }),
  )
  const parsed = JSON.parse(extractJsonBlock(raw)) as { ok?: boolean; provider?: string; model?: string; message?: string }
  return {
    ok: parsed.ok === true || parsed.message?.length !== 0,
    provider: parsed.provider ?? config.provider,
    model: parsed.model ?? config.model,
    message: parsed.message ?? '连接成功',
  }
}

export function buildAnalysisTags(
  type: AiAnalysisHistoryRecord['type'],
  confidence: AiConfidence,
  stock?: Pick<Stock, 'market' | 'code' | 'name'>,
) {
  const tags = [
    type === 'portfolio' ? '组合分析' : '个股分析',
    confidence === 'high' ? '高信心' : confidence === 'medium' ? '中等信心' : '低信心',
  ]
  if (stock) {
    tags.push(stock.code, stock.market, stock.name)
  }
  return tags
}
