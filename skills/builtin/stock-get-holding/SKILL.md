---
name: stock.getHolding
description: 读取单只股票的本地持仓、成本、盈亏和备注。
version: 1
scopes:
  - stock.read
inputs:
  stockId: string
dependencies:
  - lib/finance.ts
script: lib/agent/skills/stock.ts#stockGetHoldingSkill
---

# 使用场景

当用户询问某只已持仓股票的走势、成本、盈亏、仓位、是否继续持有或风险时使用。

# 不适用场景

- 用户询问未持仓股票时，应使用 `stock.getExternalQuote`。
- 用户询问组合整体风险时，应优先使用组合类 Skill。

# 输出要求

返回精简持仓摘要，不返回完整原始交易对象。
