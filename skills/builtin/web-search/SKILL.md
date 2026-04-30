---
name: web.search
description: 通过 Playwright 模拟浏览器搜索最新财报、公告、新闻等公开信息，并抓取二级页面内容。
version: 1
scopes:
  - network.fetch
inputs:
  query: string
  limit: number?
  searchLimit: number?
dependencies:
  - playwright
script: lib/agent/skills/search.ts#webSearchSkill
---

# 使用场景

当内置 Skill 无法覆盖用户需要的最新数据时使用（如财报、公告、新闻等）。
通过 Playwright 驱动搜索引擎获取候选结果，再打开二级页面抓取正文并做相关性筛选。

# 不适用场景

- 不负责生成投资分析或评级。
- 搜索结果可能包含付费广告或不可靠来源。

# 输出要求

返回搜索结果列表，每项包含标题、摘要、URL、搜索源和二级页面正文摘要。
