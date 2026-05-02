import { detectStockCode, formatStockCandidate, matchStocks } from '@/lib/agent/entity/stockMatcher'
import type { AgentPlan, AgentSkillCall } from '@/lib/agent/types'
import type { AiChatMessage, AiConfig, Market, Stock } from '@/types'
import { callJsonCompletion } from '@/lib/external/llmProvider'

const PORTFOLIO_KEYWORDS = ['组合', '仓位', '持仓', '风险', '亏损', '盈利', '收益', '回撤', '集中', '配置', '哪只', '哪些']
const TRADE_KEYWORDS = ['交易', '复盘', '买入', '卖出', '分红', '成本', '加仓', '减仓']
const OUT_OF_SCOPE_KEYWORDS = ['天气', '菜谱', '写代码', '编程', '电影', '小说', '医疗', '法律', '旅游', '翻译']
const MARKET_OPTIONS: Market[] = ['A', 'HK', 'US', 'FUND', 'CRYPTO']

function includesAny(content: string, keywords: string[]) {
  return keywords.some((keyword) => content.includes(keyword))
}

const FINANCIAL_KEYWORDS = ['财报', '业绩', '营收', '利润', '盈利', '净利润', 'EPS', '每股收益', '分红', '派息', '增长', '同比', '环比']
const EXPLICIT_PORTFOLIO_KEYWORDS = ['组合', '全部', '整体', '所有', '每只', '哪些', '哪只', '仓位', '配置']
const FOLLOW_UP_STOCK_KEYWORDS = ['收益', '盈利', '亏损', '成本', '均价', '平均', '持仓', '分红', '手续费', '操作', '建议', '怎么看', '怎么样', '多少']
const STOCK_WEB_SEARCH_KEYWORDS = ['新闻', '消息', '公告', '披露', '利好', '利空', '催化', '传闻', '监管', '处罚', '停牌', '复牌', '减持', '增持', '回购', '中标', '诉讼', '调查', '澄清']
const STOCK_ANNOUNCEMENT_KEYWORDS = ['公告', '披露', '停牌', '复牌', '减持', '增持', '回购', '业绩预告', '业绩快报', '年报', '季报', '半年报', '重大事项', '澄清']
const A_SHARE_MARKET_KEYWORDS = ['A股', 'A 股', '大盘', '盘面', '沪指', '上证', '深成指', '创业板', '两市', '三大指数']
const MARKET_WEB_SEARCH_KEYWORDS = ['今日', '今天', '新闻', '消息', '政策', '大事件', '事件', '盘面', '发生', '利好', '利空', '监管', '会议', '降准', '降息', '证监会']

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
  if (shouldSearchStockWeb(userMessage)) {
    skills.push(
      {
        name: 'web.search',
        args: { query: buildStockWebSearchQuery(stock, userMessage), limit: 5, searchLimit: 10 },
        reason: '用户询问个股新闻、公告、利好利空或今日事件，需要检索公开网页来源',
      },
    )
  }
  return skills
}

type StockSearchTarget = Pick<Stock, 'code' | 'name' | 'market'>

function shouldSearchStockWeb(content: string) {
  return includesAny(content, STOCK_WEB_SEARCH_KEYWORDS)
    || /(今天|今日|最新).*(发生|消息|新闻|公告|利好|利空|怎么了|什么事|事件)/.test(content)
    || /(发生了什么|出了?什么事|有什么消息|有啥消息|怎么了)/.test(content)
}

function isAnnouncementQuestion(content: string) {
  return includesAny(content, STOCK_ANNOUNCEMENT_KEYWORDS) || includesAny(content, ['财报', '业绩'])
}

function getAStockAuthorityHint(code: string) {
  if (/^6/.test(code)) return '巨潮资讯 上交所 官方公告'
  if (/^[023]/.test(code)) return '巨潮资讯 深交所 官方公告'
  return '巨潮资讯 交易所 官方公告'
}

function buildStockWebSearchQuery(stock: StockSearchTarget, content: string) {
  const year = String(new Date().getFullYear())
  const identity = [stock.name, stock.code].filter(Boolean).join(' ')
  if (isAnnouncementQuestion(content)) {
    const authorityHint = stock.market === 'A' ? getAStockAuthorityHint(stock.code) : '官方公告'
    return `${identity} 最新公告 ${year} ${authorityHint}`.trim()
  }
  if (includesAny(content, ['利好', '利空'])) {
    return `${identity} 今日新闻 利好 利空 ${year}`.trim()
  }
  return `${identity} 最新新闻 今日发生了什么 ${year}`.trim()
}

function shouldSearchAShareMarketWeb(content: string) {
  return includesAny(content, A_SHARE_MARKET_KEYWORDS) && includesAny(content, MARKET_WEB_SEARCH_KEYWORDS)
}

function buildAShareMarketWebSearchQuery(content: string) {
  const year = String(new Date().getFullYear())
  if (includesAny(content, ['政策', '降准', '降息', '证监会'])) {
    return `A股 今日政策 新闻 证监会 央行 财政部 ${year}`
  }
  return `A股 今日大盘 新闻 盘面 大事件 政策 ${year}`
}

function inferMarketFromCode(code: string): Market | null {
  if (/^\d{6}$/.test(code)) return 'A'
  if (/^\d{5}$/.test(code)) return 'HK'
  if (/^[A-Z]{1,6}$/.test(code)) return 'US'
  return null
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
  '- web.search: 通过 Google 搜索最新财报、公告、新闻等公开信息，适用于需要最新数据但内置接口不可用的场景',
  '- web.fetch: 抓取指定 URL 的外部金融数据（仅限白名单域名）',
  '',
  '规则：',
  '- 如果用户问题与股票投资无关（天气/编程/娱乐等），intent 设为 out_of_scope，responseMode 设为 refuse',
  '- 如果标的不明确，responseMode 设为 clarify',
  '- 如果用户询问某只个股的新闻、公告、利好利空、今日发生了什么、出了什么事，必须规划 web.search',
  '- 如果用户询问 A 股大盘今日大事件、政策、盘面新闻或发生了什么，必须规划 web.search；可同时读取 market.getAnalysisContext',
  '- A 股公告类 web.search query 应包含股票名称/代码，并优先加入 巨潮资讯、上交所/深交所、官方公告 等权威来源词',
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

function findRecentStockFocus(history: AiChatMessage[] | undefined, stocks: Stock[]) {
  for (const message of [...(history ?? [])].reverse()) {
    const agent = message.contextSnapshot?.agent as { entities?: unknown } | undefined
    const entities = agent?.entities
    if (!Array.isArray(entities)) continue

    for (const entity of entities) {
      if (!entity || typeof entity !== 'object') continue
      const stockId = 'stockId' in entity && typeof entity.stockId === 'string' ? entity.stockId : ''
      const code = 'code' in entity && typeof entity.code === 'string' ? entity.code : ''
      const name = 'name' in entity && typeof entity.name === 'string' ? entity.name : ''
      const stock = stocks.find((item) => item.id === stockId)
        ?? (code ? stocks.find((item) => item.code.toUpperCase() === code.toUpperCase()) : undefined)
        ?? (name ? stocks.find((item) => item.name === name) : undefined)
      if (stock) return stock
    }
  }
  return null
}

function shouldUseRecentStockFocus(content: string) {
  if (!includesAny(content, FOLLOW_UP_STOCK_KEYWORDS)) return false
  return !includesAny(content, EXPLICIT_PORTFOLIO_KEYWORDS)
}

export async function planAgentResponse({
  userMessage,
  stocks,
  history,
  externalStocks = [],
  aiConfig,
}: {
  userMessage: string
  stocks: Stock[]
  history?: AiChatMessage[]
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
      if (shouldSearchStockWeb(content)) {
        base.push({
          name: 'web.search',
          args: {
            query: buildStockWebSearchQuery({ code: item.symbol, name: item.symbol, market: item.market }, content),
            limit: 5,
            searchLimit: 10,
          },
          reason: '用户询问未持仓标的的新闻、公告、利好利空或今日事件，需要检索公开网页来源',
        })
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

  if (shouldSearchAShareMarketWeb(content)) {
    return {
      intent: 'market_question',
      entities: [{ type: 'market', raw: 'A股大盘', market: 'A', confidence: 0.82 }],
      requiredSkills: [
        { name: 'market.getAnalysisContext', args: { market: 'A' }, reason: '用户询问 A 股大盘，需要读取指数、技术指标和新闻上下文' },
        { name: 'web.search', args: { query: buildAShareMarketWebSearchQuery(content), limit: 5, searchLimit: 10 }, reason: '用户询问 A 股大盘今日事件、政策或盘面新闻，需要检索公开网页来源' },
      ],
      responseMode: 'answer',
    }
  }

  if (code && !matches.length) {
    const inferredMarket = inferMarketFromCode(code)
    if (inferredMarket && shouldSearchStockWeb(content)) {
      return {
        intent: 'stock_analysis',
        entities: [{ type: 'stock', raw: code, code, market: inferredMarket, confidence: 0.72 }],
        requiredSkills: [
          { name: 'stock.getExternalQuote', args: { symbol: code, market: inferredMarket }, reason: '用户询问未持仓标的，代码可推断市场，先抓取外部行情' },
          { name: 'web.search', args: { query: buildStockWebSearchQuery({ code, name: code, market: inferredMarket }, content), limit: 5, searchLimit: 10 }, reason: '用户询问个股新闻、公告、利好利空或今日事件，需要检索公开网页来源' },
        ],
        responseMode: 'answer',
      }
    }
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

  const recentStockFocus = findRecentStockFocus(history, stocks)
  if (recentStockFocus && shouldUseRecentStockFocus(content)) {
    return {
      intent: includesAny(content, TRADE_KEYWORDS) ? 'trade_review' : 'stock_analysis',
      entities: [{
        type: 'stock',
        raw: content,
        stockId: recentStockFocus.id,
        code: recentStockFocus.code,
        name: recentStockFocus.name,
        market: recentStockFocus.market,
        confidence: 0.78,
      }],
      requiredSkills: buildStockSkillCalls(recentStockFocus, content),
      responseMode: 'answer',
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
