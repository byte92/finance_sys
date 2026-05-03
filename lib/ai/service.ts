import { createHash } from 'node:crypto'
import { buildAnalysisSystemPrompt, PORTFOLIO_ANALYSIS_PROMPT, STOCK_ANALYSIS_PROMPT } from '@/lib/agent/prompts/analysis'
import { runPortfolioAnalysisAgentTask, runStockAnalysisAgentTask } from '@/lib/agent/tasks/analysis'
import { callJsonCompletion } from '@/lib/external/llmProvider'
import { logger } from '@/lib/observability/logger'
import type { PortfolioAnalysisContext, StockAnalysisContext } from '@/lib/agent/skills/analysis'
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

type FallbackProbabilityInput = {
  bias: 'bullish' | 'neutral' | 'bearish'
  confidence: AiConfidence
  note: string
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

function buildPromptEnvelope(config: AiConfig, analysisPrompt: string, outputContract: Record<string, unknown>, task: string, context: unknown) {
  return {
    system: buildAnalysisSystemPrompt(config.analysisLanguage, analysisPrompt),
    user: JSON.stringify({
      task,
      intensity: 'high',
      horizons: {
        short: '1-5 个交易日',
        medium: '1-4 周',
      },
      outputRules: [
        '必须先得出结论，再给出证据依据；summary 第一句话必须包含明确主动作。',
        '个股主动作只能从“买入 / 加仓 / 继续持有 / 减仓 / 卖出 / 观望 / 回避”中选择；组合主动作只能从“继续持有 / 分批减仓 / 控制仓位 / 暂不加仓 / 调整结构 / 等待确认”中选择。',
        '不能把“仅供参考”“结合自身情况”“继续观察”作为主结论；若选择观望或等待确认，必须说明等待的具体信号、当前不操作的原因和后续触发动作。',
        'actionPlan 必须是可执行清单，每条都要包含动作、触发条件或原因，不能只写泛泛提醒。',
        '禁止输出“不要只凭单一信号操作”“避免情绪化买卖”“投资有风险”这类用户已经知道的常识句，必须替换为当前标的或组合的具体条件。',
        '凡是提到“支撑”“阻力”“新闻情绪”“趋势确认”“风险边界”，必须给出具体数值、方向、依据或明确说明当前数据缺失。',
        '个股 actionPlan 至少包含一条买入/加仓触发条件、一条减仓/卖出触发条件，以及一条继续持有或观望的前提。',
        '必须把事实与推断分开表达。',
        '必须给出概率分析，且概率总和为 100。',
        '高强度模式下必须给明确倾向，且必须回答“现在更应该做什么”“现在不该做什么”。',
        '结论不能停留在“继续观察”这种空泛表述，除非你明确说明观察的原因、等待的信号和不建议动作的原因。',
        '如果证据不足，请明确写出信息不足和需要继续观察的信号。',
        '如果新闻、技术面、盈亏结构彼此矛盾，必须指出矛盾来源，并说明当前更应优先看哪一项。',
      ],
      context,
      outputContract,
    }),
  }
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

function buildFallbackProbability({ bias, confidence, note }: FallbackProbabilityInput): AiProbabilityScenario[] {
  const templates = bias === 'bullish'
    ? { up: 50, flat: 30, down: 20 }
    : bias === 'bearish'
      ? { up: 20, flat: 30, down: 50 }
      : confidence === 'low'
        ? { up: 30, flat: 40, down: 30 }
        : { up: 33, flat: 37, down: 30 }

  return [
    {
      label: '上涨',
      probability: templates.up,
      rationale: bias === 'bullish'
        ? `当前证据更偏向上行延续，前提是 ${note}。`
        : `当前没有足够证据支持强势上行，除非 ${note}。`,
    },
    {
      label: '震荡',
      probability: templates.flat,
      rationale: bias === 'neutral'
        ? `现阶段更像等待确认的震荡区间，核心观察点是 ${note}。`
        : `即便当前有方向倾向，仍可能先进入震荡消化，重点看 ${note}。`,
    },
    {
      label: '下跌',
      probability: templates.down,
      rationale: bias === 'bearish'
        ? `当前下行风险更高，若 ${note} 未改善，弱势更容易延续。`
        : `若 ${note} 被证伪，回撤风险会明显抬升。`,
    },
  ]
}

function inferPortfolioFallback(context: PortfolioAnalysisContext) {
  const topHolding = [...context.summaries].sort((left, right) => right.holdingWeight - left.holdingWeight)[0] ?? null
  const winRate = context.summaries.length > 0 ? context.profitableCount / context.summaries.length : 0
  const bias: FallbackProbabilityInput['bias'] =
    context.totalUnrealizedPnl > 0 && winRate >= 0.6 ? 'bullish'
      : context.totalUnrealizedPnl < 0 && winRate < 0.5 ? 'bearish'
        : 'neutral'
  const confidence: AiConfidence = context.summaries.length >= 3 ? 'medium' : 'low'
  const note = topHolding
    ? `${topHolding.name} 的仓位权重与浮盈回撤是否继续稳定`
    : '组合中核心仓位是否继续稳定'
  return { bias, confidence, note }
}

function buildPortfolioFallbackPayload(context: PortfolioAnalysisContext): Partial<AiAnalysisResult> {
  const topHolding = context.topHoldings[0] ?? null
  const weakest = context.weakestHoldings[0] ?? null
  const strongest = context.strongestHoldings[0] ?? null
  const concentrationHigh = context.largestPositionWeight >= 0.5
  const profitableMore = context.profitableCount >= context.losingCount
  const stance = concentrationHigh
    ? '偏防守，先处理集中度'
    : context.totalUnrealizedPnl < 0
      ? '偏谨慎，先看回撤控制'
      : profitableMore
        ? '可继续持有，但不宜激进扩张'
        : '中性偏谨慎'

  const summary = concentrationHigh
    ? `当前组合明显偏集中，首要任务不是继续加风险，而是先处理 ${topHolding?.name ?? '核心仓位'} 的集中度与回撤承受能力。当前更偏向先控节奏、再看是否需要分批降权，而不是继续扩大单一仓位。`
    : context.totalUnrealizedPnl < 0
      ? `当前组合整体承压，短期更偏向先稳住回撤，再判断是否需要进一步调整弱势仓位。当前不适合因为个别反弹就贸然加仓，更应该先确认拖累来源有没有改善。`
      : `当前组合仍有正向缓冲，但更适合继续持有并观察结构变化，不适合在现阶段盲目放大风险。当前更应该保持优势仓位的稳定性，而不是急着做高频切换。`

  const facts = [
    `当前组合共有 ${context.summaries.length} 只持仓，按当前持仓成本口径计算，最大仓位占比 ${(context.largestPositionWeight * 100).toFixed(1)}%。`,
    `当前在投本金约 ${context.totalCurrentCost.toFixed(2)} ${context.baseCurrency}，已实现收益约 ${context.totalRealizedPnl.toFixed(2)} ${context.baseCurrency}，未实现盈亏约 ${context.totalUnrealizedPnl.toFixed(2)} ${context.baseCurrency}。`,
    `历史累计买入额约 ${context.totalHistoricalBuyAmount.toFixed(2)} ${context.baseCurrency}，今日组合盈亏约 ${context.totalDailyPnl.toFixed(2)} ${context.baseCurrency}，当前盈利持仓 ${context.profitableCount} 只，亏损持仓 ${context.losingCount} 只。`,
  ]

  const inferences = [
    concentrationHigh
      ? `${topHolding?.name ?? '第一大仓位'} 权重过高，当前组合风险主要来自单一持仓回撤，而不是整体机会不足。`
      : '当前组合的主要问题不是极端集中，而是结构是否继续分化与盈利能否延续。',
    weakest
      ? `${weakest.name} 是当前最弱持仓之一，如果弱势继续拖累，更应优先处理它而不是追逐已经盈利的仓位。`
      : '当前弱势仓位数量有限，重点仍在组合结构的稳定性。',
  ]

  const actionPlan = [
    concentrationHigh
      ? `现在更应该优先评估 ${topHolding?.name ?? '第一大仓位'} 是否需要分批降权或至少停止继续加仓。`
      : '现在更应该先维持现有结构，观察强弱分化是否继续扩散，再决定是否做分批调整。',
    strongest
      ? `当前更适合把 ${strongest.name} 视为组合稳定器继续跟踪，而不是急着用弱势仓位去对冲掉已有优势。`
      : '当前不适合因为单日波动就频繁切换仓位节奏。',
    '现在不适合在没有新增确认信号之前盲目追高，也不适合仅因为一两天回撤就情绪化清仓。',
  ]

  const invalidationSignals = [
    topHolding
      ? `${topHolding.name} 若出现明显回撤且权重仍维持高位，当前“继续持有观察”的结论应重新评估。`
      : '若核心仓位明显转弱，当前结论需要重新评估。',
    strongest
      ? `${strongest.name} 若失去趋势优势，而弱势仓位同步扩大亏损，组合应从持有转向更偏防守。`
      : '若强势仓位失去支撑，组合需要转向更谨慎的处理方式。',
  ]

  const portfolioRiskNotes = [
    concentrationHigh
      ? '当前最主要的组合风险是仓位过度集中带来的回撤放大。'
      : '当前组合的主要风险来自结构分化，而不是单一仓位失控。',
    weakest ? `${weakest.name} 是当前更值得优先关注的拖累源。` : '暂未识别出特别突出的拖累源。',
  ]

  const actionableObservations = [
    topHolding ? `优先看 ${topHolding.name} 的仓位变化与浮盈保护，而不是先看次要仓位。` : '优先观察核心仓位而不是边缘仓位。',
    context.recentlyActiveHoldings[0]
      ? `最近有交易动作的 ${context.recentlyActiveHoldings[0].name} 更值得优先复盘，确认你当前节奏是否与组合现状一致。`
      : '优先复盘最近有交易动作的仓位，确认当前节奏是否合理。',
  ]

  const keyLevels = [
    topHolding ? `重点观察 ${topHolding.name} 对组合净值波动的放大效应。` : '关注核心仓位对组合波动的影响。',
    '若组合未实现盈利持续回撤，优先考虑收缩风险暴露而不是继续加仓。',
  ]

  return {
    summary,
    stance,
    facts,
    inferences,
    actionPlan,
    invalidationSignals,
    portfolioRiskNotes,
    actionableObservations,
    keyLevels,
    evidence: facts,
  }
}

function inferStockFallback(context: StockAnalysisContext) {
  const { indicators, quote } = context
  const changePercent = quote?.changePercent ?? 0
  const trendBias = indicators?.trendBias ?? 'neutral'
  const newsNegative = context.news.filter((item) => /下调|调查|下跌|利空|风险|裁员|诉讼|减持/i.test(`${item.title} ${item.summary}`)).length
  const newsPositive = context.news.filter((item) => /上调|增长|盈利|利好|合作|回购|新高|超预期/i.test(`${item.title} ${item.summary}`)).length

  let bias: FallbackProbabilityInput['bias'] = 'neutral'
  if (trendBias === 'bullish' && changePercent >= 0 && newsPositive >= newsNegative) bias = 'bullish'
  if (trendBias === 'bearish' || newsNegative > newsPositive + 1 || changePercent <= -3) bias = 'bearish'

  const confidence: AiConfidence =
    indicators && context.news.length > 0 ? 'high'
      : indicators || context.news.length > 0 ? 'medium'
        : 'low'
  const note = indicators?.supportLevel && indicators?.resistanceLevel
    ? `是否守住 ${indicators.supportLevel.toFixed(2)} 附近支撑并挑战 ${indicators.resistanceLevel.toFixed(2)} 附近阻力`
    : '关键价位与新闻情绪是否继续同向'

  return { bias, confidence, note }
}

function normalizeAnalysisResult(parsed: Partial<AiAnalysisResult> | null, fallback: { summary: string; evidence: string[]; signals?: AiTechnicalSignal[]; news?: AiNewsDriver[]; mode: 'portfolio' | 'stock' }): AiAnalysisResult {
  const summary = parsed?.summary?.trim() || fallback.summary
  const fallbackInput = fallback.mode === 'portfolio'
    ? { bias: 'neutral' as const, confidence: 'medium' as const, note: '组合集中度与盈利回撤是否继续改善' }
    : { bias: 'neutral' as const, confidence: 'medium' as const, note: '关键价位与新闻情绪是否继续同向' }
  const probabilityAssessment = parsed?.probabilityAssessment?.length ? parsed.probabilityAssessment : buildFallbackProbability(fallbackInput)
  return {
    generatedAt: new Date().toISOString(),
    cached: false,
    analysisStrength: 'high',
    summary,
    stance: parsed?.stance?.trim() || '中性偏观察',
    facts: parsed?.facts?.length ? parsed.facts : fallback.evidence,
    inferences: parsed?.inferences?.length ? parsed.inferences : [summary],
    actionPlan: parsed?.actionPlan?.length
      ? parsed.actionPlan
      : fallback.mode === 'stock'
        ? [
            '现在建议以继续持有或观望为主，除非价格、趋势和新闻信号同时改善。',
            '暂不建议仅凭单一技术信号追高加仓，先确认关键支撑和量价结构是否有效。',
            '如果跌破关键支撑或新闻面明显转弱，则应重新评估是否减仓控制风险。',
          ]
        : [
            '现在建议先从仓位集中度和回撤控制角度处理组合风险，而不是只看单票盈亏。',
            '暂不建议在强弱分化没有改善前继续放大风险暴露。',
            '如果核心持仓继续转弱或最大仓位回撤扩大，则优先考虑分批降风险。',
          ],
    invalidationSignals: parsed?.invalidationSignals?.length
      ? parsed.invalidationSignals
      : ['若关键支撑/阻力被有效突破，或新闻与量价结构明显反向，应重新评估当前结论。'],
    timeHorizons: parsed?.timeHorizons?.length ? parsed.timeHorizons : [
      { horizon: 'short', summary: '未来 1-5 个交易日以观察关键价位与量能变化为主。', scenarios: probabilityAssessment },
      { horizon: 'medium', summary: '未来 1-4 周重点观察趋势延续与新闻兑现情况。', scenarios: probabilityAssessment },
    ],
    probabilityAssessment,
    technicalSignals: parsed?.technicalSignals?.length ? parsed.technicalSignals : (fallback.signals ?? []),
    newsDrivers: parsed?.newsDrivers?.length ? parsed.newsDrivers : (fallback.news ?? []),
    keyLevels: parsed?.keyLevels?.length ? parsed.keyLevels : ['关注近期支撑/阻力是否被有效突破'],
    positionAdvice: fallback.mode === 'stock'
      ? (parsed?.positionAdvice?.length
          ? parsed.positionAdvice
          : [
              '若已有持仓且未跌破关键支撑，优先继续持有并观察确认信号。',
              '若计划新增买入，等待突破阻力或回踩支撑有效后再考虑分批，而不是一次性追入。',
            ])
      : undefined,
    portfolioRiskNotes: fallback.mode === 'portfolio' ? (parsed?.portfolioRiskNotes?.length ? parsed.portfolioRiskNotes : ['优先留意单一标的过度集中和盈利回撤风险。']) : undefined,
    actionableObservations: parsed?.actionableObservations?.length ? parsed.actionableObservations : ['把 AI 结论作为复盘辅助，而不是独立交易依据。'],
    risks: parsed?.risks?.length ? parsed.risks : ['外部新闻、行情与估值数据可能延迟或缺失。'],
    confidence: parsed?.confidence ?? fallbackInput.confidence,
    disclaimer: parsed?.disclaimer?.trim() || '以上内容仅基于当前数据进行条件式分析，不构成投资建议或收益承诺。',
    evidence: parsed?.evidence?.length ? parsed.evidence : fallback.evidence,
  }
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
      logger.warn('ai.analysis.parseJson.failed', { rawPreview: raw.slice(0, 500) })
      return null
    }
  }
}

async function callProvider(config: AiConfig, systemPrompt: string, userPrompt: string) {
  return callJsonCompletion(config, systemPrompt, userPrompt)
}

function portfolioPrompt(context: PortfolioAnalysisContext, config: AiConfig) {
  return buildPromptEnvelope(
    config,
    PORTFOLIO_ANALYSIS_PROMPT,
    {
      analysisStrength: 'high|medium|weak',
      summary: 'string',
      stance: 'string',
      facts: ['string'],
      inferences: ['string'],
      actionPlan: ['string'],
      invalidationSignals: ['string'],
      timeHorizons: [{ horizon: 'short|medium', summary: 'string', scenarios: [{ label: 'string', probability: 'number', rationale: 'string' }] }],
      probabilityAssessment: [{ label: 'string', probability: 'number', rationale: 'string' }],
      portfolioRiskNotes: ['string'],
      actionableObservations: ['string'],
      risks: ['string'],
      confidence: 'low|medium|high',
      evidence: ['string'],
      disclaimer: 'string',
    },
    '请对当前组合做短中期分析，重点关注仓位集中度、已实现/未实现盈亏结构、主要风险暴露，并给出可执行的组合操作建议。',
    context,
  )
}

function stockPrompt(context: StockAnalysisContext, config: AiConfig) {
  return buildPromptEnvelope(
    config,
    STOCK_ANALYSIS_PROMPT,
    {
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
      positionAdvice: ['string'],
      actionableObservations: ['string'],
      risks: ['string'],
      confidence: 'low|medium|high',
      evidence: ['string'],
      disclaimer: 'string',
    },
    '请对这只股票从持仓视角给出短中期分析，结合技术指标、持仓成本、盈亏状态与新闻驱动，给出买入、卖出、继续持有、减仓或观望等明确操作建议。',
    context,
  )
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

function classifyStockNews(news: NewsItem[]) {
  const positivePattern = /上调|增长|盈利|利好|合作|回购|新高|超预期|增持|净买入|中标|突破/i
  const negativePattern = /下调|调查|下跌|利空|风险|裁员|诉讼|减持|净卖出|亏损|处罚/i
  const positiveCount = news.filter((item) => positivePattern.test(`${item.title} ${item.summary}`)).length
  const negativeCount = news.filter((item) => negativePattern.test(`${item.title} ${item.summary}`)).length
  const bias = positiveCount > negativeCount
    ? '偏正向'
    : negativeCount > positiveCount
      ? '偏负向'
      : news.length > 0
        ? '中性或分化'
        : '暂无新闻数据'

  return { bias, positiveCount, negativeCount }
}

function formatPriceLevel(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '暂无'
}

function buildStockFallbackPayload(context: StockAnalysisContext): Partial<AiAnalysisResult> {
  const { indicators, quote, stock, summary } = context
  const support = formatPriceLevel(indicators?.supportLevel)
  const resistance = formatPriceLevel(indicators?.resistanceLevel)
  const currentPrice = typeof quote?.price === 'number' ? quote.price.toFixed(2) : '暂无'
  const newsSentiment = classifyStockNews(context.news)
  const trend = indicators?.trendBias ?? 'neutral'
  const hasLevels = support !== '暂无' && resistance !== '暂无'

  return {
    summary: `${stock.name} 当前主动作偏继续持有或观望：现价 ${currentPrice}，近 20 日支撑 ${support}、阻力 ${resistance}，新闻情绪${newsSentiment.bias}；只有站上阻力并且新闻继续偏正向时才考虑加仓，跌破支撑或新闻转负时优先减仓控风险。`,
    facts: [
      `当前持仓 ${summary.currentHolding}，已实现收益 ${summary.realizedPnl.toFixed(2)}，未实现盈亏 ${summary.unrealizedPnl.toFixed(2)}。`,
      `当前价格 ${currentPrice}，近 20 日支撑 ${support}，近 20 日阻力 ${resistance}，趋势偏向 ${trend}。`,
      `新闻情绪${newsSentiment.bias}：正向线索 ${newsSentiment.positiveCount} 条，负向线索 ${newsSentiment.negativeCount} 条。`,
    ],
    inferences: [
      hasLevels
        ? `现价相对 ${support}-${resistance} 区间的位置决定短线动作：未突破阻力前不宜把“继续持有”升级为加仓，跌破支撑则持有前提失效。`
        : '当前缺少完整支撑/阻力数据，因此操作上应降低进攻性，优先等价位结构补全后再判断。',
      newsSentiment.bias === '偏正向'
        ? '新闻面暂时提供正向支撑，但仍需要价格突破阻力来确认。'
        : newsSentiment.bias === '偏负向'
          ? '新闻面偏负向，短线应先防守而不是主动加仓。'
          : '新闻面没有形成明确方向，短线更应以价位触发条件为准。',
    ],
    actionPlan: [
      `现在建议继续持有或观望：只要价格没有有效跌破 ${support}，先不急于卖出。`,
      `如果价格放量站上 ${resistance}，且新闻情绪维持正向，再考虑分批加仓；否则不把持有升级为买入。`,
      `如果价格跌破 ${support}，或新闻情绪从当前的${newsSentiment.bias}转为偏负向，则优先减仓或停止新增买入。`,
    ],
    invalidationSignals: [
      `跌破 ${support} 会削弱继续持有前提。`,
      `无法突破 ${resistance} 且新闻转负，会削弱加仓或继续乐观的前提。`,
    ],
    keyLevels: [
      `近 20 日支撑：${support}`,
      `近 20 日阻力：${resistance}`,
      `当前价格：${currentPrice}`,
    ],
    positionAdvice: [
      `持仓者：守住 ${support} 可继续持有观察，跌破则优先控制风险。`,
      `准备买入者：等突破 ${resistance} 或回踩 ${support} 后重新转强，再考虑分批。`,
    ],
    actionableObservations: [
      `下一步优先看价格是否在 ${support}-${resistance} 区间内完成方向选择。`,
      `新闻面当前${newsSentiment.bias}，若方向变化，需要同步更新操作计划。`,
    ],
    evidence: [
      `支撑 ${support}`,
      `阻力 ${resistance}`,
      `新闻情绪${newsSentiment.bias}`,
    ],
  }
}

function stockResultNeedsConcreteFallback(result: AiAnalysisResult, context: StockAnalysisContext) {
  const summary = result.summary
  const support = formatPriceLevel(context.indicators?.supportLevel)
  const resistance = formatPriceLevel(context.indicators?.resistanceLevel)
  const newsSentiment = classifyStockNews(context.news).bias
  const usesAbstractTriggers = /关键支撑|关键阻力|新闻情绪|趋势确认|支撑和阻力/.test(summary)
  const repeatsLowValueWarning = /单一信号|情绪化买|情绪化卖|情绪化操作/.test(summary)
  const missesConcreteLevels = support !== '暂无' && resistance !== '暂无' && (!summary.includes(support) || !summary.includes(resistance))
  const missesNewsDirection = newsSentiment !== '暂无新闻数据' && !summary.includes(newsSentiment)

  return repeatsLowValueWarning || (usesAbstractTriggers && (missesConcreteLevels || missesNewsDirection))
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

  const task = await runPortfolioAnalysisAgentTask(stocks, aiConfig, { baseCurrency: 'CNY' })
  const context = task.context
  const { system, user } = portfolioPrompt(context, aiConfig)
  const raw = await callProvider(aiConfig, system, user)
  const parsed = safeParseJsonObject<Partial<AiAnalysisResult>>(raw)

  const result = normalizeAnalysisResult(parsed, {
    summary: `当前组合包含 ${context.summaries.length} 只资产，最大仓位占比约 ${(context.largestPositionWeight * 100).toFixed(1)}%，适合优先关注集中度和浮盈回撤。`,
    evidence: [
      `当前在投本金约 ${context.totalCurrentCost.toFixed(2)} ${context.baseCurrency}`,
      `已实现收益约 ${context.totalRealizedPnl.toFixed(2)} ${context.baseCurrency}`,
      `未实现盈亏约 ${context.totalUnrealizedPnl.toFixed(2)} ${context.baseCurrency}`,
    ],
    mode: 'portfolio',
  })
  const portfolioFallback = buildPortfolioFallbackPayload(context)
  result.summary = parsed?.summary?.trim() || portfolioFallback.summary || result.summary
  result.stance = parsed?.stance?.trim() || portfolioFallback.stance || result.stance
  result.facts = parsed?.facts?.length ? parsed.facts : (portfolioFallback.facts || result.facts)
  result.inferences = parsed?.inferences?.length ? parsed.inferences : (portfolioFallback.inferences || result.inferences)
  result.actionPlan = parsed?.actionPlan?.length ? parsed.actionPlan : (portfolioFallback.actionPlan || result.actionPlan)
  result.invalidationSignals = parsed?.invalidationSignals?.length ? parsed.invalidationSignals : (portfolioFallback.invalidationSignals || result.invalidationSignals)
  result.portfolioRiskNotes = parsed?.portfolioRiskNotes?.length ? parsed.portfolioRiskNotes : (portfolioFallback.portfolioRiskNotes || result.portfolioRiskNotes)
  result.actionableObservations = parsed?.actionableObservations?.length ? parsed.actionableObservations : (portfolioFallback.actionableObservations || result.actionableObservations)
  result.keyLevels = parsed?.keyLevels?.length ? parsed.keyLevels : (portfolioFallback.keyLevels || result.keyLevels)
  result.evidence = parsed?.evidence?.length ? parsed.evidence : (portfolioFallback.evidence || result.evidence)
  if (!parsed?.probabilityAssessment?.length) {
    const inferred = inferPortfolioFallback(context)
    result.probabilityAssessment = buildFallbackProbability(inferred)
    result.confidence = parsed?.confidence ?? inferred.confidence
  }
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

  const task = await runStockAnalysisAgentTask(stock, aiConfig)
  const context = task.context
  const { summary, quote, indicators, news } = context

  const { system, user } = stockPrompt(context, aiConfig)
  const raw = await callProvider(aiConfig, system, user)
  const parsed = safeParseJsonObject<Partial<AiAnalysisResult>>(raw)

  const stockFallback = buildStockFallbackPayload(context)
  const result = normalizeAnalysisResult(parsed, {
    summary: stockFallback.summary ?? `${stock.name} 当前主动作偏继续持有或观望。`,
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
  if (!parsed?.probabilityAssessment?.length) {
    const inferred = inferStockFallback(context)
    result.probabilityAssessment = buildFallbackProbability(inferred)
    result.confidence = parsed?.confidence ?? inferred.confidence
  }
  result.summary = parsed?.summary?.trim() || stockFallback.summary || result.summary
  result.facts = parsed?.facts?.length ? parsed.facts : (stockFallback.facts || result.facts)
  result.inferences = parsed?.inferences?.length ? parsed.inferences : (stockFallback.inferences || result.inferences)
  result.actionPlan = parsed?.actionPlan?.length ? parsed.actionPlan : (stockFallback.actionPlan || result.actionPlan)
  result.invalidationSignals = parsed?.invalidationSignals?.length ? parsed.invalidationSignals : (stockFallback.invalidationSignals || result.invalidationSignals)
  result.keyLevels = parsed?.keyLevels?.length ? parsed.keyLevels : (stockFallback.keyLevels || result.keyLevels)
  result.positionAdvice = parsed?.positionAdvice?.length ? parsed.positionAdvice : (stockFallback.positionAdvice || result.positionAdvice)
  result.actionableObservations = parsed?.actionableObservations?.length ? parsed.actionableObservations : (stockFallback.actionableObservations || result.actionableObservations)
  result.evidence = parsed?.evidence?.length ? parsed.evidence : (stockFallback.evidence || result.evidence)
  if (stockResultNeedsConcreteFallback(result, context)) {
    result.summary = stockFallback.summary || result.summary
    result.facts = stockFallback.facts || result.facts
    result.inferences = stockFallback.inferences || result.inferences
    result.actionPlan = stockFallback.actionPlan || result.actionPlan
    result.invalidationSignals = stockFallback.invalidationSignals || result.invalidationSignals
    result.keyLevels = stockFallback.keyLevels || result.keyLevels
    result.positionAdvice = stockFallback.positionAdvice || result.positionAdvice
    result.actionableObservations = stockFallback.actionableObservations || result.actionableObservations
    result.evidence = stockFallback.evidence || result.evidence
  }
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
  const parsed = safeParseJsonObject<{ ok?: boolean; provider?: string; model?: string; message?: string }>(raw)
  if (!parsed) {
    return {
      ok: true,
      provider: config.provider,
      model: config.model,
      message: '模型已连通，但返回内容不是严格 JSON，已按兼容模式处理。',
    }
  }
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
  _strength: AiAnalysisResult['analysisStrength'],
  stock?: Pick<Stock, 'market' | 'code' | 'name'>,
) {
  const tags = [
    type === 'portfolio' ? '组合分析' : type === 'market' ? '大盘分析' : '个股分析',
    confidence === 'high' ? '高信心' : confidence === 'medium' ? '中等信心' : '低信心',
  ]
  if (stock) {
    tags.push(stock.code, stock.market, stock.name)
  }
  return tags
}
