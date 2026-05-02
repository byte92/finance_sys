# Contributing to StockTracker

感谢你愿意参与 StockTracker。这个项目希望长期保持几个品质：本地优先、计算透明、边界清楚、AI 克制、代码可维护。

## 可以贡献什么

- 修复 bug。
- 补充测试。
- 改进文档。
- 优化界面和交互。
- 新增或修复行情数据源。
- 改进 Agent Runtime、Planner、Skill 和上下文管理。
- 改进手续费、收益计算和数据导入导出能力。

## 开始之前

请先阅读：

- [README.md](./README.md)
- [开发指南](./docs/DEVELOPMENT.md)
- [项目目录结构](./docs/PROJECT_STRUCTURE.md)
- [数据接口清单](./docs/DATA_API_INVENTORY.md)
- [Agent 架构设计](./docs/AGENT_ARCHITECTURE.md)

## 本地开发

```bash
pnpm install
pnpm dev
```

默认访问：

- [http://localhost:3000](http://localhost:3000)

## 提交前检查

至少运行：

```bash
pnpm test
pnpm build
```

如果修改了外部 API、行情源、新闻、汇率、K 线或 LLM provider，请额外运行：

```bash
pnpm test:external
```

如果修改了收益、手续费、FIFO、分红或成本计算，请重点检查：

- `lib/finance.ts`
- `config/defaults.ts`
- `tests/finance.test.ts`

这类变更必须有测试或清楚的人工校验说明。

## 代码风格

- 使用 TypeScript。
- 优先复用现有模块和类型。
- 外部 API 请求放在 `lib/external` 或 `lib/dataSources`。
- API Route 只做参数校验、调用服务和返回响应。
- 组件不要直接拼外部服务 URL。
- 注释保持克制，说明职责和复杂逻辑即可。
- 新增 `class` 时请添加中文职责注释。

## 文档要求

如果你的改动影响以下内容，请同步更新文档：

- 环境变量。
- 外部 API。
- 数据库结构。
- Agent / Skill 行为。
- 目录结构。
- 用户可见功能。

相关文档通常位于 `docs/`。

## Pull Request 建议

一个 PR 尽量聚焦一类问题。提交说明建议包含：

- 做了什么。
- 为什么这样做。
- 如何验证。
- 是否影响数据结构或用户数据。
- 是否新增外部 API 或环境变量。

## Issue 建议

提交问题时请尽量提供：

- 复现步骤。
- 当前行为。
- 期望行为。
- 浏览器和系统信息。
- 控制台或终端错误。
- 是否配置了 AI 或行情 API Key。

## 安全与隐私

不要在 Issue、PR、截图或日志里提交真实 API Key、SQLite 数据库、交易记录或个人资产信息。

安全问题请按 [SECURITY.md](./SECURITY.md) 处理。
