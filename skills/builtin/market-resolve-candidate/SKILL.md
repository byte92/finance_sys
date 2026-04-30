---
name: market.resolveCandidate
description: 根据用户输入的名称或代码，返回候选标的列表（含市场推断）。
version: 1
scopes:
  - quote.read
inputs:
  query: string
dependencies:
  - lib/agent/entity/stockMatcher.ts
script: lib/agent/skills/market.ts#marketResolveCandidateSkill
---

# 使用场景

当用户输入股票名称、代码或简称，但该标的未在当前持仓中、或存在多市场歧义时使用。
返回候选列表供 Planner 决定是否需要澄清或直接抓取行情。

# 不适用场景

- 不负责抓取行情数据（由 stock.getExternalQuote 负责）。
- 不负责生成最终投资分析。

# 输出要求

返回 candidates 数组，每项包含 code、name、market、confidence。
如果本地持仓有匹配，优先返回持仓信息。
如果无匹配，按代码规则推断可能的市场（纯数字→A股，数字.HK→港股，字母→美股）。
