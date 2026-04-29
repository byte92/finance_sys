---
name: portfolio.getTopPositions
description: 读取组合中最值得关注的持仓，包括最大仓位、最大盈利、最大亏损和近期活跃标的。
version: 1
scopes:
  - portfolio.read
inputs:
  limit: number
dependencies:
  - lib/finance.ts
script: lib/agent/skills/portfolio.ts#portfolioGetTopPositionsSkill
---

# 使用场景

当用户询问组合风险、重点关注对象、亏损最多、盈利最多、仓位集中度或最近活跃标的时使用。

# 不适用场景

- 不用于回答单只股票的详细走势。
- 不返回所有持仓，只返回 Top N 关键列表。

# 输出要求

输出按仓位、盈利、亏损和最近交易排序的精简持仓集合。
