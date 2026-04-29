---
name: portfolio.getAnalysisContext
description: 为固定组合 AI 分析读取完整但受控的组合上下文。
version: 1
scopes:
  - portfolio.read
  - quote.read
inputs:
  baseCurrency: string
dependencies:
  - lib/finance.ts
  - lib/ExchangeRateService.ts
  - lib/StockPriceService.ts
script: lib/agent/skills/analysis.ts#portfolioGetAnalysisContextSkill
prompt: lib/agent/prompts/analysis.ts#PORTFOLIO_ANALYSIS_PROMPT
---

# 使用场景

当系统执行固定模板的 AI 组合分析时使用。

# 不适用场景

- 用户在自由对话中只询问单只股票时，不应调用本 Skill。
- 用户只需要轻量组合摘要时，应优先使用 `portfolio.getSummary`。

# 输出要求

返回组合分析需要的仓位权重、行情、盈亏结构、近期交易活动和强弱持仓摘要，不返回完整原始交易明细。

# 提示词边界

组合分析提示词由本 Skill 绑定的固定模板维护。设置页不再支持覆盖该提示词；如需定制，应新增或替换 Skill。
