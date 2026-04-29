# 项目目录结构说明

本文档记录 StockTracker 当前推荐的目录边界，帮助后续开发减少跨层耦合。

## 顶层目录

| 目录 | 职责 |
| --- | --- |
| `app/` | Next.js App Router 页面和 API Route。页面负责组装视图，API Route 负责参数校验和调用领域服务。 |
| `components/` | React 组件。通用 UI 放在 `components/ui`，业务组件按领域放在 `ai`、`market`、`portfolio` 等子目录。 |
| `config/` | 默认配置和静态配置，例如市场、手续费、数据源默认值。 |
| `docs/` | 产品、架构、接口清单和维护文档。 |
| `hooks/` | 浏览器侧 React hooks。 |
| `lib/` | 领域逻辑、数据源适配、AI/Agent Runtime、SQLite、本地工具函数。 |
| `skills/` | Agent Skill Markdown 描述文件。内置 Skill 放在 `skills/builtin`。 |
| `store/` | Zustand store，负责前端状态和本地持久化协调。 |
| `tests/` | Node test runner 测试。默认测试不依赖真实外部网络；外部接口 smoke test 使用 `npm run test:external`。 |
| `types/` | 跨模块共享类型。 |

## `lib/` 目录边界

| 目录 / 文件 | 职责 |
| --- | --- |
| `lib/dataSources/` | 当前报价数据源适配，例如腾讯、Nasdaq、Yahoo、Stooq、Alpha Vantage。 |
| `lib/external/` | 外部 API 的统一入口，例如 K 线、新闻、指数、LLM Provider。 |
| `lib/agent/` | Agent Runtime、Planner、Executor、Skill 注册和固定分析 Task。 |
| `lib/ai/` | AI 对话、配置、建议问题和历史分析服务。 |
| `lib/sqlite/` | 本地 SQLite 读写。 |
| `lib/api/` | 内部 API 请求辅助函数。 |
| `lib/finance.ts` | 交易、手续费、持仓和盈亏计算。 |
| `lib/marketOverview.ts` | 大盘业务聚合。外部请求应通过 `lib/external/*` 完成。 |
| `lib/StockPriceService.ts` | 当前报价聚合、fallback 和缓存。后续可继续拆成 registry/cache/service。 |
| `lib/ExchangeRateService.ts` | 汇率服务。后续如继续统一外部 API，可迁移到 `lib/external/exchangeRates.ts`。 |

## 清理规则

- 不保留空目录。新增目录时应同时包含实际代码、文档或占位说明。
- 不提交本地调试产物，例如 `.DS_Store`、`.playwright-mcp/`、`*.tsbuildinfo`、SQLite 本地数据文件。
- 不保留一次性接口调试脚本。外部接口有效性统一放在 `tests/external-apis.test.ts`。
- 外部 API 请求应优先放入 `lib/external` 或 `lib/dataSources`，业务层和组件层不直接拼外部 URL。
- 浏览器组件可以调用内部 API Route；如果调用继续增多，建议新增 `lib/clientApi` 统一 typed client。
