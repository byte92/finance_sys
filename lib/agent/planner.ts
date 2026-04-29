import { detectStockCode, formatStockCandidate, matchStocks } from '@/lib/agent/entity/stockMatcher'
import type { AgentPlan } from '@/lib/agent/types'
import type { Market, Stock } from '@/types'

const PORTFOLIO_KEYWORDS = ['组合', '仓位', '持仓', '风险', '亏损', '盈利', '收益', '回撤', '集中', '配置', '哪只', '哪些']
const TRADE_KEYWORDS = ['交易', '复盘', '买入', '卖出', '分红', '成本', '加仓', '减仓']
const OUT_OF_SCOPE_KEYWORDS = ['天气', '菜谱', '写代码', '编程', '电影', '小说', '医疗', '法律', '旅游', '翻译']
const MARKET_OPTIONS: Market[] = ['A', 'HK', 'US', 'FUND', 'CRYPTO']

function includesAny(content: string, keywords: string[]) {
  return keywords.some((keyword) => content.includes(keyword))
}

function buildStockSkillCalls(stockId: string) {
  return [
    { name: 'stock.getHolding', args: { stockId }, reason: '用户询问单只股票，需要读取本地持仓摘要' },
    { name: 'stock.getRecentTrades', args: { stockId, limit: 8 }, reason: '单只股票分析需要结合最近交易节奏' },
    { name: 'stock.getQuote', args: { stockId }, reason: '单只股票分析需要读取最新行情和估值数据' },
    { name: 'stock.getTechnicalSnapshot', args: { stockId }, reason: '走势健康度需要技术指标摘要' },
  ]
}

export function planAgentResponse({
  userMessage,
  stocks,
  externalStocks = [],
}: {
  userMessage: string
  stocks: Stock[]
  externalStocks?: Array<{ symbol: string; market: Market }>
}): AgentPlan {
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
      requiredSkills: buildStockSkillCalls(stock.id),
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
    return {
      intent: 'stock_analysis',
      entities: externalStocks.map((item) => ({ type: 'stock', raw: item.symbol, code: item.symbol, market: item.market, confidence: 0.8 })),
      requiredSkills: externalStocks.map((item) => ({
        name: 'stock.getExternalQuote',
        args: { symbol: item.symbol, market: item.market },
        reason: '用户询问未持仓标的，需按用户选择的市场抓取行情数据',
      })),
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

  return {
    intent: 'unknown',
    entities: [{ type: 'portfolio', raw: '当前组合', confidence: 0.45 }],
    requiredSkills: [
      { name: 'portfolio.getSummary', args: {}, reason: '意图不明确时提供轻量组合摘要作为兜底上下文' },
      { name: 'portfolio.getTopPositions', args: { limit: 5 }, reason: '意图不明确时提供少量关键持仓用于回答' },
    ],
    responseMode: 'answer',
  }
}
