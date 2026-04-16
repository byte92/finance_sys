// 默认费用配置 - 可由用户在配置页修改
import type { AiConfig, AiPromptTemplates, AppConfig, FeeConfig, Market } from '@/types'

export const DEFAULT_FEE_CONFIGS: Record<Market, FeeConfig> = {
  A: {
    market: 'A',
    commissionRate: 0.0001,    // 万一（可按券商实际费率调整）
    minCommission: 5,           // 最低5元
    stampDutyRate: 0.0005,      // 万五（普通股票卖出）
    transferFeeRate: 0.00001,   // 万0.1（普通股票双向）
  },
  HK: {
    market: 'HK',
    commissionRate: 0.0003,
    minCommission: 50,          // 港币
    stampDutyRate: 0.0013,      // 港股印花税 1.3‱ 买卖均收
    transferFeeRate: 0,
    settlementFeeRate: 0.00002,
  },
  US: {
    market: 'US',
    commissionRate: 0,          // 美股通常零佣金
    minCommission: 0,
    stampDutyRate: 0,
    transferFeeRate: 0,
  },
  FUND: {
    market: 'FUND',
    commissionRate: 0.001,      // 基金申购费
    minCommission: 0,
    stampDutyRate: 0,
    transferFeeRate: 0,
  },
  CRYPTO: {
    market: 'CRYPTO',
    commissionRate: 0.001,      // 交易所手续费 万十
    minCommission: 0,
    stampDutyRate: 0,
    transferFeeRate: 0,
  },
}

export const DEFAULT_AI_PROMPT_TEMPLATES: AiPromptTemplates = {
  baseSystem: [
    '你是一名严谨、客观、可追责的投研分析助手。',
    '你的核心任务不是写一篇泛泛的财经总结，而是基于输入数据输出有证据支撑的判断。',
    '必须明确区分“事实”“推断”“建议”“风险”。',
    '严禁编造未提供的新闻、估值、技术指标、价格或持仓信息。',
    '缺少关键数据时必须直接说明“信息不足”，不能用空泛语句掩盖。',
    '允许给出明确倾向，但不允许承诺收益，也不允许使用“必涨”“必跌”“一定”等绝对表述。',
    '输出必须严格遵守 JSON 合约，且概率总和必须为 100。',
  ].join('\n'),
  portfolioAnalysis: [
    '请从组合管理视角分析：',
    '1. 先判断当前组合的收益结构、仓位集中度和风险暴露。',
    '2. 再指出当前组合最需要警惕的风险源和最值得关注的机会点。',
    '3. 行动建议要围绕“持有 / 观望 / 分批调整 / 控制风险”展开，不能空泛。',
    '4. 如果组合内部信号分化，要明确指出矛盾点，而不是强行给统一乐观结论。',
  ].join('\n'),
  stockAnalysis: [
    '请从单只股票的持仓视角分析：',
    '1. 先给出当前状态判断，例如偏强、震荡、转弱、等待确认等。',
    '2. 概率分析必须覆盖短期上涨 / 震荡 / 下跌，以及中期偏强 / 中性 / 偏弱。',
    '3. 必须结合成本区、当前盈亏、技术指标和新闻催化来解释结论。',
    '4. 必须告诉用户当前更适合做什么：继续持有、等待、减仓、回避、仅观察等。',
    '5. 不能只复述技术指标，要把指标转成可执行的判断。',
  ].join('\n'),
  marketAnalysis: [
    '请从大盘节奏与风险偏好视角分析：',
    '1. 分别看 A 股、港股、美股的强弱和风格变化。',
    '2. 指出哪个市场更强、哪个市场更弱，以及这种分化对交易节奏意味着什么。',
    '3. 建议必须偏节奏判断，例如风险偏好抬升、适合防守、等待确认，而不是泛泛而谈。',
  ].join('\n'),
}

export const AI_MAX_STRENGTH_PROMPT = [
  '默认按最高强度模式输出。',
  '你必须给出明确、直接、有取向的指导意见。',
  '请清晰回答“现在更应该做什么、不该做什么”。',
  '如果证据不足以支持积极动作，也要明确写“当前不建议操作”或“当前不适合追高/抄底”。',
  '可以使用更直接的表述，例如“更偏向继续持有”“更偏向减仓控制风险”，但仍不能使用绝对判断。',
].join('\n')

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  provider: 'openai-compatible',
  baseUrl: '',
  model: '',
  apiKey: '',
  temperature: 0.3,
  maxTokens: 1400,
  newsEnabled: true,
  analysisLanguage: 'zh-CN',
  promptTemplates: DEFAULT_AI_PROMPT_TEMPLATES,
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  version: '1.0.0',
  defaultMarket: 'A',
  feeConfigs: DEFAULT_FEE_CONFIGS,
  aiConfig: DEFAULT_AI_CONFIG,
  currency: {
    A: 'CNY',
    HK: 'HKD',
    US: 'USD',
    FUND: 'CNY',
    CRYPTO: 'USDT',
  },
}

export const MARKET_LABELS: Record<Market, string> = {
  A: 'A股',
  HK: '港股',
  US: '美股',
  FUND: '基金',
  CRYPTO: '加密货币',
}
