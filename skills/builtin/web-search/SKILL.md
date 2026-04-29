---
name: web.search
description: 通过 Google 搜索引擎查找最新财报、公告、新闻等公开信息。
version: 1
scopes:
  - network.fetch
inputs:
  query: string
  limit: number?
dependencies:
  - playwright
script: lib/agent/skills/search.ts#webSearchSkill
---

# 使用场景

当内置 Skill 无法覆盖用户需要的最新数据时使用（如财报、公告、新闻等）。
通过 Playwright 驱动 Google 搜索并提取结构化结果。

# 不适用场景

- 不负责生成投资分析或评级。
- 搜索结果可能包含付费广告或不可靠来源。

# 输出要求

返回搜索结果列表，每项包含标题、摘要、URL 和来源域名。
