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

金融类问题会保留通用自由搜索能力，同时按场景扩展 query：

- A 股公告、定期报告、业绩预告等优先尝试巨潮资讯、上交所、深交所等官方/权威来源。
- 个股新闻、利好利空、今日发生了什么，使用股票名称/代码 + 新闻/消息/利好利空等通用检索词。
- A 股大盘今日事件、政策、盘面新闻，使用 A 股、大盘、政策、盘面、大事件等通用检索词。

# 不适用场景

- 不负责生成投资分析或评级。
- 搜索结果可能包含付费广告或不可靠来源。

# 输出要求

返回搜索结果列表，每项包含标题、摘要、URL、搜索源和二级页面正文摘要。
回答生成时应把结果作为“公开网页候选来源”引用，标明搜索时间、标题、链接和摘要/要点，不应表述为实时数据库事实。
