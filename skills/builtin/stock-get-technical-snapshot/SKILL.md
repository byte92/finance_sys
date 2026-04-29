---
name: stock.getTechnicalSnapshot
description: 读取单只股票的技术指标摘要。
version: 1
scopes:
  - quote.read
inputs:
  stockId: string
dependencies:
  - lib/technicalIndicators.ts
  - lib/StockPriceService.ts
script: lib/agent/skills/stock.ts#stockGetTechnicalSnapshotSkill
---

# 使用场景

当用户询问走势是否健康、趋势、支撑阻力、均线、MACD、RSI、波动或技术面风险时使用。

# 不适用场景

- 基金或加密资产没有可用 K 线时，允许返回空技术指标。
- 不单独作为买卖结论，应与持仓、成本和行情一起使用。

# 输出要求

返回技术指标快照和样本数量；数据不足时明确返回空值。
