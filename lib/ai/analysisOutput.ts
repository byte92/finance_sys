import type {
  AiAnalysisResult,
  AiNewsDriver,
  AiProbabilityScenario,
  AiTechnicalSignal,
} from '@/types'

export type AnalysisOutputMode = 'portfolio' | 'stock' | 'market'

const COMMON_OUTPUT_CONTRACT = {
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
} satisfies Record<string, unknown>

const MODE_OUTPUT_CONTRACT = {
  portfolio: {
    ...COMMON_OUTPUT_CONTRACT,
    portfolioRiskNotes: ['string'],
  },
  stock: {
    ...COMMON_OUTPUT_CONTRACT,
    positionAdvice: ['string'],
  },
  market: COMMON_OUTPUT_CONTRACT,
} satisfies Record<AnalysisOutputMode, Record<string, unknown>>

const REQUIRED_ARRAY_FIELDS = [
  'facts',
  'inferences',
  'actionPlan',
  'invalidationSignals',
  'timeHorizons',
  'probabilityAssessment',
  'technicalSignals',
  'newsDrivers',
  'keyLevels',
  'actionableObservations',
  'risks',
  'evidence',
] as const

export function getAnalysisOutputRules(mode: AnalysisOutputMode) {
  const scope = mode === 'portfolio' ? '组合' : mode === 'market' ? '大盘' : '标的'
  return [
    '必须严格返回 outputContract 中列出的所有字段，字段名完全一致，不得省略、改名或返回 Markdown。',
    '所有数组字段必须至少 1 条；如果输入缺少对应数据，也必须返回结构化的“数据不足/未提供”说明，不能省略字段或返回空数组。',
    `${scope}分析里的 technicalSignals、newsDrivers、keyLevels 必须按当前分析对象解释：组合用组合层面的技术/新闻/风险阈值，大盘用指数层面的技术/新闻/关键点位，标的用个股层面的技术/新闻/关键价位。`,
    '无法从 context 证实的新闻、价格、指标、支撑阻力或持仓信息，不得编造；必须明确写出缺失原因和下一步需要的数据。',
  ]
}

export function getAnalysisOutputContract(mode: AnalysisOutputMode, fields?: string[]) {
  const contract: Record<string, unknown> = MODE_OUTPUT_CONTRACT[mode]
  if (!fields?.length) return contract

  return fields.reduce<Record<string, unknown>>((result, field) => {
    if (field in contract) result[field] = contract[field]
    return result
  }, {})
}

export function collectMissingAnalysisFields(parsed: Partial<AiAnalysisResult> | null, mode: AnalysisOutputMode) {
  if (!parsed) {
    return ['__json__']
  }

  const missing: string[] = []
  if (!['high', 'medium', 'weak'].includes(String(parsed.analysisStrength))) missing.push('analysisStrength')
  if (!['low', 'medium', 'high'].includes(String(parsed.confidence))) missing.push('confidence')
  for (const field of ['summary', 'stance', 'disclaimer'] as const) {
    const value = parsed[field]
    if (typeof value !== 'string' || !value.trim()) missing.push(field)
  }
  for (const field of REQUIRED_ARRAY_FIELDS) {
    const value = parsed[field]
    if (!Array.isArray(value) || value.length === 0) missing.push(field)
  }
  if (mode === 'stock' && (!Array.isArray(parsed.positionAdvice) || parsed.positionAdvice.length === 0)) missing.push('positionAdvice')
  if (mode === 'portfolio' && (!Array.isArray(parsed.portfolioRiskNotes) || parsed.portfolioRiskNotes.length === 0)) missing.push('portfolioRiskNotes')
  return Array.from(new Set(missing))
}

export function withAnalysisFieldFallbacks(
  parsed: Partial<AiAnalysisResult>,
  mode: AnalysisOutputMode,
  missingFields: string[],
): Partial<AiAnalysisResult> {
  if (!missingFields.length) return parsed

  const next: Partial<AiAnalysisResult> = { ...parsed }
  for (const field of missingFields) {
    if (field === '__json__') continue
    const fallback = fallbackAnalysisField(field, mode)
    if (fallback !== undefined) {
      ;(next as Record<string, unknown>)[field] = fallback
    }
  }
  return next
}

function fallbackAnalysisField(field: string, mode: AnalysisOutputMode) {
  switch (field) {
    case 'analysisStrength':
      return 'weak' satisfies AiAnalysisResult['analysisStrength']
    case 'confidence':
      return 'low' satisfies AiAnalysisResult['confidence']
    case 'summary':
      return `${modeLabel(mode)}分析信息不足，当前只能先按低置信度处理；建议补充行情、新闻和持仓上下文后重新生成。`
    case 'stance':
      return '等待确认'
    case 'disclaimer':
      return '当前分析仅基于系统已提供的数据生成；缺失行情、新闻或技术指标时，结论置信度会下降。'
    case 'facts':
      return [`当前 ${modeLabel(mode)} 上下文没有返回足够事实字段，已按信息不足处理。`]
    case 'inferences':
      return ['证据链不完整，暂不适合把缺失字段解读为明确方向。']
    case 'actionPlan':
      return ['现在建议先补充或刷新行情、新闻和技术指标，再依据完整分析执行操作。']
    case 'invalidationSignals':
      return ['如果补充数据后与当前低置信度判断相反，需要重新生成分析。']
    case 'timeHorizons':
      return [
        {
          horizon: 'short',
          summary: '短期证据不足，先等待更多数据确认。',
          scenarios: fallbackProbabilityAssessment(),
        },
        {
          horizon: 'medium',
          summary: '中期判断需要补充行情、新闻和持仓变化后再确认。',
          scenarios: fallbackProbabilityAssessment(),
        },
      ] satisfies AiAnalysisResult['timeHorizons']
    case 'probabilityAssessment':
      return fallbackProbabilityAssessment()
    case 'technicalSignals':
      return [fallbackTechnicalSignal(mode)] satisfies AiTechnicalSignal[]
    case 'newsDrivers':
      return [fallbackNewsDriver()] satisfies AiNewsDriver[]
    case 'keyLevels':
      return [fallbackKeyLevel(mode)]
    case 'actionableObservations':
      return ['优先补齐缺失数据，再决定是否调整仓位或交易节奏。']
    case 'risks':
      return ['字段缺失导致分析置信度下降，直接据此操作的风险较高。']
    case 'evidence':
      return ['当前结论来自可解析字段和系统兜底校验，缺失字段未被当作事实使用。']
    case 'positionAdvice':
      return ['标的分析缺少完整持仓建议，建议刷新后再决定买入、加仓、减仓或卖出。']
    case 'portfolioRiskNotes':
      return ['组合分析缺少完整风险备注，建议刷新后再评估集中度、回撤和结构风险。']
    default:
      return undefined
  }
}

function fallbackProbabilityAssessment(): AiProbabilityScenario[] {
  return [{ label: '信息不足', probability: 100, rationale: '模型未返回可验证的概率拆分，当前只能按低置信度处理。' }]
}

function fallbackTechnicalSignal(mode: AnalysisOutputMode): AiTechnicalSignal {
  return {
    name: mode === 'market' ? '指数技术数据' : mode === 'portfolio' ? '组合技术数据' : '标的技术数据',
    value: '数据不足',
    interpretation: '当前上下文未提供足够技术指标，不能据此确认趋势或支撑阻力。',
  }
}

function fallbackNewsDriver(): AiNewsDriver {
  return {
    headline: '未提供明确新闻驱动',
    source: '系统上下文',
    publishedAt: new Date().toISOString(),
    sentiment: 'neutral',
    impact: '当前上下文没有足够新闻材料，不能据此判断催化方向。',
    url: '',
  }
}

function fallbackKeyLevel(mode: AnalysisOutputMode) {
  if (mode === 'portfolio') return '组合关键风险阈值缺失：需要补充持仓市值、成本和最新行情后确认。'
  if (mode === 'market') return '大盘关键点位缺失：需要补充指数支撑、阻力或技术指标后确认。'
  return '标的关键价位缺失：需要补充最新价格、支撑阻力或成本区后确认。'
}

function modeLabel(mode: AnalysisOutputMode) {
  if (mode === 'portfolio') return '组合'
  if (mode === 'market') return '大盘'
  return '标的'
}
