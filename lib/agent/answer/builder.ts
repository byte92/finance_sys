import type { AgentAnswerDraft, AgentAnswerItem, AgentPlan, AgentSkillResult } from '@/lib/agent/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function addItem(items: AgentAnswerItem[], label: string, value: unknown, source: string, note?: string) {
  if (value === undefined || value === null || value === '') return
  items.push({ label, value, source, note })
}

function findResult(skillResults: AgentSkillResult[], name: string) {
  return skillResults.find((result) => result.skillName === name)
}

function getData(result: AgentSkillResult | undefined) {
  return result?.ok && isRecord(result.data) ? result.data : null
}

function getSummary(data: Record<string, unknown> | null) {
  return isRecord(data?.summary) ? data.summary : null
}

function getQuote(data: Record<string, unknown> | null) {
  return isRecord(data?.quote) ? data.quote : null
}

function getIndicators(data: Record<string, unknown> | null) {
  return isRecord(data?.indicators) ? data.indicators : null
}

function hasSkill(skillResults: AgentSkillResult[], name: string) {
  return skillResults.some((result) => result.skillName === name)
}

function inferAnswerType(plan: AgentPlan): AgentAnswerDraft['answerType'] {
  if (plan.responseMode === 'refuse') return 'refusal'
  if (plan.responseMode === 'clarify') return 'clarify'
  if (plan.intent === 'trade_review') return 'trade_review'
  if (plan.intent === 'portfolio_risk' || plan.intent === 'portfolio_summary') return 'portfolio_review'
  if (plan.intent === 'market_question') return 'market_review'
  if (plan.intent === 'stock_analysis') return 'stock_holding_review'
  return 'general'
}

function computeConfidence(missingData: AgentAnswerItem[], qualityWarnings: AgentAnswerItem[]) {
  if (missingData.length >= 2 || qualityWarnings.length >= 3) return 'low'
  if (missingData.length || qualityWarnings.length) return 'medium'
  return 'high'
}

export function buildAgentAnswerDraft(plan: AgentPlan, skillResults: AgentSkillResult[]): AgentAnswerDraft {
  const answerType = inferAnswerType(plan)
  const facts: AgentAnswerItem[] = []
  const calculations: AgentAnswerItem[] = []
  const inferences: AgentAnswerItem[] = []
  const missingData: AgentAnswerItem[] = []
  const recommendations: AgentAnswerItem[] = []
  const qualityWarnings: AgentAnswerItem[] = []

  for (const result of skillResults) {
    if (!result.ok) {
      addItem(missingData, result.skillName, result.error ?? 'Skill 执行失败', result.skillName)
    }
  }

  const holdingData = getData(findResult(skillResults, 'stock.getHolding'))
  const holdingSummary = getSummary(holdingData)
  if (holdingData) {
    const stock = isRecord(holdingData.stock) ? holdingData.stock : null
    addItem(facts, '标的', stock?.name ? `${stock.name} (${stock.code ?? 'unknown'})` : stock?.code, 'stock.getHolding')
  }
  if (holdingSummary) {
    addItem(facts, '当前持仓', holdingSummary.currentHolding, 'stock.getHolding')
    addItem(calculations, '平均成本价', holdingSummary.avgCostPrice, 'stock.getHolding')
    addItem(calculations, '已实现收益', holdingSummary.realizedPnl, 'stock.getHolding', '来自本地交易记录，含已落库分红与手续费口径。')
    addItem(calculations, '未实现收益', holdingSummary.unrealizedPnl, 'stock.getHolding', holdingSummary.pnlIncludesMarketPrice ? '按最新行情价计算。' : '未提供最新行情价时为 0。')
    addItem(calculations, '总收益', holdingSummary.totalPnl, 'stock.getHolding', holdingSummary.pnlIncludesMarketPrice ? '已实现收益 + 按最新行情价计算的未实现收益。' : '仅本地交易记录口径，未包含实时行情变化。')
    addItem(calculations, '手续费合计', holdingSummary.totalCommission, 'stock.getHolding')
    addItem(calculations, '分红合计', holdingSummary.totalDividend, 'stock.getHolding')
    addItem(facts, '行情价格', holdingSummary.marketPrice, 'stock.getHolding')
    addItem(facts, '市值', holdingSummary.marketValue, 'stock.getHolding')
    if (!holdingSummary.pnlIncludesMarketPrice) {
      addItem(missingData, '实时行情价', '缺少行情价，不能计算当前未实现盈亏。', 'stock.getHolding')
    }
  }

  const tradesData = getData(findResult(skillResults, 'stock.getRecentTrades'))
  const trades = Array.isArray(tradesData?.trades) ? tradesData.trades.filter(isRecord) : []
  if (trades.length) {
    const lastTrade = trades.at(-1)
    addItem(facts, '最近交易', lastTrade ? `${lastTrade.date} ${lastTrade.type} ${lastTrade.quantity ?? ''} @ ${lastTrade.price ?? ''}` : null, 'stock.getRecentTrades')
    if (answerType === 'trade_review') {
      addItem(qualityWarnings, '单笔收益缺口', '当前上下文只有最近交易列表和持仓摘要，没有单笔 FIFO 盈亏明细；不要把累计收益说成这笔交易的收益。', 'stock.getRecentTrades')
    }
  } else if (hasSkill(skillResults, 'stock.getRecentTrades')) {
    addItem(missingData, '最近交易', '没有可用的最近交易记录。', 'stock.getRecentTrades')
  }

  const quote = getQuote(getData(findResult(skillResults, 'stock.getQuote')))
  if (quote) {
    addItem(facts, '当前价格', quote.price, 'stock.getQuote')
    addItem(facts, '涨跌幅', quote.changePercent, 'stock.getQuote')
    addItem(facts, 'PE TTM', quote.peTtm, 'stock.getQuote')
    addItem(facts, 'PB', quote.pb, 'stock.getQuote')
    addItem(facts, '行情时间', quote.timestamp, 'stock.getQuote')
  }

  const indicators = getIndicators(getData(findResult(skillResults, 'stock.getTechnicalSnapshot')))
  if (indicators) {
    addItem(facts, '技术趋势', indicators.trendBias, 'stock.getTechnicalSnapshot')
    addItem(facts, 'RSI14', indicators.rsi14, 'stock.getTechnicalSnapshot')
    addItem(facts, '支撑位', indicators.supportLevel, 'stock.getTechnicalSnapshot')
    addItem(facts, '阻力位', indicators.resistanceLevel, 'stock.getTechnicalSnapshot')
    if (answerType === 'trade_review') {
      addItem(qualityWarnings, '时间口径提醒', '技术指标是当前快照，只能用于事后复盘，不能直接当作交易发生当天的依据。', 'stock.getTechnicalSnapshot')
    }
  }

  const portfolioSummary = getData(findResult(skillResults, 'portfolio.getSummary'))
  if (portfolioSummary) {
    addItem(facts, '组合标的数', portfolioSummary.stockCount, 'portfolio.getSummary')
    addItem(facts, '活跃持仓数', portfolioSummary.activeHoldingCount, 'portfolio.getSummary')
    addItem(calculations, '组合总收益', portfolioSummary.totalPnl, 'portfolio.getSummary')
    addItem(calculations, '组合已实现收益', portfolioSummary.totalRealizedPnl, 'portfolio.getSummary')
    addItem(calculations, '组合未实现收益', portfolioSummary.totalUnrealizedPnl, 'portfolio.getSummary')
    addItem(calculations, '组合交易笔数', portfolioSummary.totalTradeCount, 'portfolio.getSummary')
  }

  if (answerType === 'trade_review') {
    addItem(inferences, '评价框架', '需要同时看是否锁定利润、是否降低仓位风险、是否符合分批计划，以及是否存在事后卖飞。', 'answer.builder')
    addItem(recommendations, '回答方式', '先给条件化结论，再列事实和计算；明确区分单笔、累计、当前行情三个口径。', 'answer.builder')
  } else if (answerType === 'stock_holding_review') {
    addItem(inferences, '评价框架', '需要区分持仓成本、已实现收益、未实现收益、估值与技术面，不要把某一项单独作为买卖结论。', 'answer.builder')
  } else if (answerType === 'portfolio_review') {
    addItem(inferences, '评价框架', '需要区分组合级收益、单只标的贡献、仓位集中度和风险来源。', 'answer.builder')
  }

  return {
    answerType,
    facts,
    calculations,
    inferences,
    missingData,
    recommendations,
    qualityWarnings,
    confidence: computeConfidence(missingData, qualityWarnings),
  }
}
