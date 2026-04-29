---
name: stock.getFinancials
description: 获取股票最近财报关键数据（EPS、营收增长、盈利增长等），首版仅支持美股。
version: 1
scopes:
  - quote.read
  - network.fetch
inputs:
  symbol: string
  market: Market
dependencies:
  - lib/agent/skills/stock.ts
  - lib/agent/skills/web.ts
script: lib/agent/skills/stock.ts#stockGetFinancialsSkill
---

# 使用场景

当用户询问持仓或未持仓股票的财报数据时使用。
美股通过 Yahoo Finance API 直接获取；A 股/港股自动 fallback 到 web.fetch。

# 不适用场景

- 不负责生成投资分析或评级。
- 首版不包含完整的三大报表数据。

# 输出要求

返回 EPS（实际/预期/超预期值）、营收同比增速、盈利同比增速、财报发布日期和数据源。
如果本地抓取失败，自动触发 web.fetch 兜底。
