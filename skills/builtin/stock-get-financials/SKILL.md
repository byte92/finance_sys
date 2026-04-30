---
name: stock.getFinancials
description: 获取股票最近财报关键数据（EPS、营收增长、盈利增长等），支持美股并为 A 股提供结构化财报兜底。
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
美股通过 Yahoo Finance API 获取；A 股优先读取结构化财务数据源，失败时建议追加公开搜索。

# 不适用场景

- 不负责生成投资分析或评级。
- 不包含完整三大报表，只返回最近财报关键指标。

# 输出要求

返回 EPS（实际/预期/超预期值）、营收同比增速、盈利同比增速、财报发布日期和数据源。
如果结构化数据不可用，返回后续搜索建议，由 Agent 追加公开信息检索。
