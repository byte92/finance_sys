---
name: stock.getExternalQuote
description: 读取未持仓股票的行情和估值数据。
version: 1
scopes:
  - quote.read
inputs:
  symbol: string
  market: string
dependencies:
  - lib/StockPriceService.ts
script: lib/agent/skills/stock.ts#stockGetExternalQuoteSkill
---

# 使用场景

当用户询问未在当前持仓中的股票，并且已经确定代码和市场时使用。

# 不适用场景

- 市场不明确时不应直接调用，应先要求用户选择具体市场。
- 不把未持仓股票当成用户持仓。

# 输出要求

返回 `inPortfolio: false`，并提供行情和估值字段。
