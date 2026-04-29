import { detectStockCode, formatStockCandidate, matchStocks } from '@/lib/agent/entity/stockMatcher'
import type { AgentPlan, AgentSkillCall } from '@/lib/agent/types'
import type { AiConfig, Market, Stock } from '@/types'
import { callJsonCompletion } from '@/lib/external/llmProvider'

const PORTFOLIO_KEYWORDS = ['组合', '仓位', '持仓', '风险', '亏损', '盈利', '收益', '回撤', '集中', '配置', '哪只', '哪些']
const TRADE_KEYWORDS = ['交易', '复盘', '买入', '卖出', '分红', '成本', '加仓', '减仓']
const OUT_OF_SCOPE_KEYWORDS = ['天气', '菜谱', '写代码', '编程', '电影', '小说', '医疗', '法律', '旅游', '翻译']
const MARKET_OPTIONS: Market[] = ['A', 'HK', 'US', 'FUND', 'CRYPTO']

function includesAny(content: string, keywords: string[]) {
  return keywords.some((keyword) => content.includes(keyword))
}

const FINANCIAL_KEYWORDS = ['财报', '业绩', '营收', '利润', '盈利', '净利润', 'EPS', '每股收益', '分红', '派息', '增长', '同比', '环比']

function buildStockSkillCalls(stock: Stock, userMessage: string): AgentSkillCall[] {
  const skills: AgentSkillCall[] = [
    { name: 'stock.getHolding', args: { stockId: stock.id }, reason: '用户询问单只股票，需要读取本地持仓摘要' },
    { name: 'stock.getRecentTrades', args: { stockId: stock.id, limit: 8 }, reason: '单只股票分析需要结合最近交易节奏' },
    { name: 'stock.getQuote', args: { stockId: stock.id }, reason: '单只股票分析需要读取最新行情和估值数据' },
    { name: 'stock.getTechnicalSnapshot', args: { stockId: stock.id }, reason: '走势健康度需要技术指标摘要' },
  ]
  // 检测财报/业绩关键词，追加财务分析 Skill
  if (includesAny(userMessage, FINANCIAL_KEYWORDS)) {
    skills.push(
      { name: 'stock.getFinancials', args: { symbol: stock.code, market: stock.market }, reason: '用户询问财报或业绩数据，需要获取最新财务指标' },
    )
  }
  return skills
}

const PLANNER_SYSTEM_PROMPT = [
  '你是 StockTracker Agent Planner。你的唯一任务是：根据用户问题输出一个 JSON 计划。',
  '你必须严格输出以下 JSON 格式，不要包含任何其他文字：',
  '{',
  '  "intent": "stock_analysis | portfolio_risk | portfolio_summary | trade_review | market_question | out_of_scope",',
  '  "entities": [{ "type": "stock | market | portfolio", "raw": "原文", "code": "代码(可选)", "market": "A|HK|US|FUND|CRYPTO(可选)", "confidence": 0.0-1.0 }],',
  '  "requiredSkills": [{ "name": "skill名称", "args": {}, "reason": "调用原因" }],',
  '  "responseMode": "answer | clarify | refuse",',
  '  "clarifyQuestion": "需澄清时间问题(仅 clarify 时填写)"',
  '}',
  '',
  '可用的 Skill：',
  '- stock.match: 匹配持仓中的股票名称或代码',
  '- stock.getHolding: 读取某只股票的持仓摘要',
  '- stock.getRecentTrades: 读取最近交易记录',
  '- stock.getQuote: 读取行情和估值',
  '- stock.getTechnicalSnapshot: 读取技术指标摘要',
  '- stock.getExternalQuote: 抓取未持仓股票行情',
  '- portfolio.getSummary: 读取组合总览',
  '- portfolio.getTopPositions: 读取最大仓位/盈亏',
  '- market.resolveCandidate: 解析名称/代码对应的候选标的',
  '- stock.getFinancials: 获取最近财报数据（EPS、营收增长等），美股通过 Yahoo Finance，其他市场自动兜底',
  '- web.fetch: 抓取外部金融数据（仅限白名单域名），仅在数据必须从网络获取时使用',
  '',
  '规则：',
  '- 如果用户问题与股票投资无关（天气/编程/娱乐等），intent 设为 out_of_scope，responseMode 设为 refuse',
  '- 如果标的不明确，responseMode 设为 clarify',
  '- 只规划数据读取 Skill，不要规划分析 Skill（如 getAnalysisContext）',
  '- args 中的值从用户消息中提取，不要编造',
].join('\n')

async function planViaLLM(userMessage: string, stocks: Stock[], aiConfig: AiConfig): Promise<AgentPlan> {
  const stockSummary = stocks.length
    ? `当前持仓：\n${stocks.map((s) => `- ${s.name} (${s.code}, ${s.market})`).join('\n')}`
    : '当前无持仓'

  const userPrompt = [
    `用户持仓信息：`,
    stockSummary,
    '',
    `用户问题：${userMessage}`,
  ].join('\n')

  try {
    const raw = await callJsonCompletion(aiConfig, PLANNER_SYSTEM_PROMPT, userPrompt)
    // 提取 JSON（可能有 markdown 代码块包裹）
    const json = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim()
    const parsed = JSON.parse(json)

    return {
      intent: parsed.intent || 'unknown',
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      requiredSkills: Array.isArray(parsed.requiredSkills) ? parsed.requiredSkills : [],
      responseMode: parsed.responseMode || 'answer',
      clarifyQuestion: parsed.clarifyQuestion,
    }
  } catch {
    // LLM 失败时回退到规则兜底
    return {
      intent: 'unknown',
      entities: [{ type: 'portfolio', raw: '当前组合', confidence: 0.45 }],
      requiredSkills: [
        { name: 'portfolio.getSummary', args: {}, reason: 'LLM Planner 失败，使用兜底组合摘要' },
        { name: 'portfolio.getTopPositions', args: { limit: 5 }, reason: 'LLM Planner 失败，使用兜底持仓' },
      ],
      responseMode: 'answer',
    }
  }
}

export async function planAgentResponse({
  userMessage,
  stocks,
  externalStocks = [],
  aiConfig,
}: {
  userMessage: string
  stocks: Stock[]
  externalStocks?: Array<{ symbol: string; market: Market }>
  aiConfig: AiConfig
}): Promise<AgentPlan> {
  const content = userMessage.trim()
  const code = detectStockCode(content)

  if (includesAny(content, OUT_OF_SCOPE_KEYWORDS) && !includesAny(content, PORTFOLIO_KEYWORDS) && !code) {
    return {
      intent: 'out_of_scope',
      entities: [],
      requiredSkills: [],
      responseMode: 'refuse',
    }
  }

  const matches = matchStocks(content, stocks, 3)
  if (matches.length === 1 && matches[0].confidence >= 0.72) {
    const stock = matches[0].stock
    return {
      intent: includesAny(content, TRADE_KEYWORDS) ? 'trade_review' : 'stock_analysis',
      entities: [{ type: 'stock', raw: content, stockId: stock.id, code: stock.code, name: stock.name, market: stock.market, confidence: matches[0].confidence }],
      requiredSkills: buildStockSkillCalls(stock, content),
      responseMode: 'answer',
    }
  }

  if (matches.length > 1 && matches[0].confidence - matches[1].confidence < 0.2) {
    return {
      intent: 'stock_analysis',
      entities: matches.map((match) => ({
        type: 'stock',
        raw: content,
        stockId: match.stock.id,
        code: match.stock.code,
        name: match.stock.name,
        market: match.stock.market,
        confidence: match.confidence,
      })),
      requiredSkills: [
        { name: 'market.resolveCandidate', args: { query: content }, reason: '存在多只可能标的，需要明确候选列表供澄清' },
      ],
      responseMode: 'clarify',
      clarifyQuestion: `你想分析的是 ${matches.map((match) => formatStockCandidate(match.stock)).join('，')} 中的哪一只？`,
    }
  }

  if (externalStocks.length) {
    const skills: AgentSkillCall[] = externalStocks.flatMap((item) => {
      const base: AgentSkillCall[] = [
        { name: 'stock.getExternalQuote', args: { symbol: item.symbol, market: item.market }, reason: '用户询问未持仓标的，需按用户选择的市场抓取行情数据' },
      ]
      if (includesAny(content, FINANCIAL_KEYWORDS)) {
        base.push(
          { name: 'stock.getFinancials', args: { symbol: item.symbol, market: item.market }, reason: '用户询问财报或业绩数据，需要获取最新财务指标' },
        )
      }
      return base
    })
    return {
      intent: 'stock_analysis',
      entities: externalStocks.map((item) => ({ type: 'stock', raw: item.symbol, code: item.symbol, market: item.market, confidence: 0.8 })),
      requiredSkills: skills,
      responseMode: 'answer',
    }
  }

  if (code && !matches.length) {
    return {
      intent: 'stock_analysis',
      entities: [{ type: 'stock', raw: code, code, confidence: 0.55 }],
      requiredSkills: [
        { name: 'market.resolveCandidate', args: { query: code }, reason: '代码未在持仓中找到，需推断候选市场' },
      ],
      responseMode: 'clarify',
      clarifyQuestion: `没有在当前持仓中找到 ${code}。请选择市场后继续：${MARKET_OPTIONS.join(' / ')}。`,
    }
  }

  if (includesAny(content, PORTFOLIO_KEYWORDS)) {
    return {
      intent: includesAny(content, ['风险', '回撤', '集中']) ? 'portfolio_risk' : 'portfolio_summary',
      entities: [{ type: 'portfolio', raw: '当前组合', confidence: 0.86 }],
      requiredSkills: [
        { name: 'portfolio.getSummary', args: {}, reason: '组合类问题需要读取组合摘要' },
        { name: 'portfolio.getTopPositions', args: { limit: 8 }, reason: '组合分析需要关注最大仓位、最大盈亏和近期活跃持仓' },
      ],
      responseMode: 'answer',
    }
  }

  // 规则无法明确判断 → LLM 兜底
  return planViaLLM(userMessage, stocks, aiConfig)
}
