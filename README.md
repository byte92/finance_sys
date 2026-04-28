# StockTracker

一个面向个人投资者的本地优先交易记录与盈亏分析工具。

当前版本聚焦这些能力：
- 本地 SQLite 持久化
- 无登录即可使用
- FIFO 已实现收益计算
- A 股 / 港股 / 美股 / 基金 / 加密资产的统一记录模型
- 可选的实时行情与估值补充

## 当前状态

这个项目已经从早期的“可选登录 / 本地缓存”方案，收口成了更明确的本地优先模式：

- 默认使用本地 SQLite 存储交易与配置
- 不强制登录
- 首页直接可用
- 保留了 `/login` 页面，但它现在只是提示“登录入口已停用”
- 支持 JSON 导出 / 导入备份

如果你是第一次接触这个仓库，可以把它理解成：

“一个运行在本机上的交易台账应用，数据默认存在你自己的电脑里。”

## 功能概览

### 已实现

- 股票 / ETF / 基金 / 港股 / 美股 / 加密资产的基础资产管理
- 买入、卖出、分红三类交易记录
- 本地 SQLite 持久化
- 首次启动自动初始化数据库
- 旧 `localStorage` 数据自动迁移到 SQLite
- 按市场自动计算手续费
- FIFO 已实现收益计算
- 当前持仓成本、浮动盈亏、总收益展示
- 交易记录中的清仓标记
- 买入批次的“该笔已卖出 / 该笔剩余”展示
- 详情页估值信息展示：`PE(TTM)`、`EPS(TTM)`、`PB`、`总市值`
- JSON 备份导出、导入、清空数据

### 当前设计取舍

- 这是本地优先应用，不是云同步 SaaS
- 现在没有多用户账号体系
- 现在没有服务端登录态
- “用户 ID” 仅用于本机本地数据隔离，不是面向终端用户的账号概念

## 从零跑起来

### 1. 环境要求

- Node.js 18+
- npm
- macOS / Linux / Windows

### 2. 克隆项目

```bash
git clone https://github.com/byte92/finance_sys.git
cd finance_sys
```

### 3. 安装依赖

```bash
npm install
```

### 4. 启动开发环境

```bash
npm run dev
```

启动后访问：

- [http://localhost:3000](http://localhost:3000)

### 5. 生产构建验证

```bash
npm test
npm run build
```

## 本地数据库初始化

这是你特别关心的部分，当前项目的行为是：

### 初始化方式

不需要手动执行建表脚本。

应用第一次启动并访问存储接口时，会自动完成：

- 创建数据库目录
- 创建 SQLite 文件
- 初始化 `portfolios` 表

相关代码在：

- [lib/sqlite/db.ts](./lib/sqlite/db.ts)
- [app/api/storage/route.ts](./app/api/storage/route.ts)

### 默认数据库位置

默认数据库文件路径：

```bash
data/finance.sqlite
```

### 自定义数据库路径

如果你想自定义 SQLite 文件位置，可以设置环境变量：

```bash
FINANCE_SQLITE_PATH=/absolute/path/to/finance.sqlite
```

例如：

```bash
FINANCE_SQLITE_PATH=./data/dev-finance.sqlite npm run dev
```

## AI 模型配置

推荐把模型连接信息放在 `.env.local`，避免 API Key 写入 SQLite 配置或 JSON 备份：

```bash
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
AI_API_KEY=sk-...
```

如果这些环境变量配置完整，服务端会优先使用 `.env.local` 中的 Provider / Base URL / Model / API Key。设置页中的连接配置会作为本地兜底；Temperature、Max Context Tokens 和提示词仍由设置页控制。

### 环境变量说明

| 变量 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `AI_PROVIDER` | 是 | `openai-compatible` | AI provider 类型。可选 `openai-compatible` 或 `anthropic-compatible`。 |
| `AI_BASE_URL` | 是 | `https://api.openai.com/v1` | AI 服务地址。OpenAI 兼容接口通常以 `/v1` 结尾；本地或第三方兼容网关也可以填写自己的地址。 |
| `AI_MODEL` | 是 | `gpt-4.1-mini` | 模型名称，由服务商决定，例如 `gpt-4.1-mini`、`deepseek-chat`、`qwen-plus`、`claude-3-5-sonnet-latest`。 |
| `AI_API_KEY` | 是 | `sk-...` | AI 服务密钥。只在服务端读取，不会发送到浏览器；真实值建议只放 `.env.local`。 |
| `ALPHA_VANTAGE_API_KEY` | 否 | `YOUR_API_KEY_HERE` | Alpha Vantage 行情备用源密钥，服务端读取。 |
| `NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY` | 否 | `YOUR_API_KEY_HERE` | 兼容旧配置，不推荐。`NEXT_PUBLIC_` 变量会暴露到前端。 |
| `FINANCE_SQLITE_PATH` | 否 | `./data/dev-finance.sqlite` | 自定义 SQLite 数据库文件路径。未设置时默认使用 `data/finance.sqlite`。 |

`.env` 与 `.env.local` 都会被 Next.js 加载；同名变量通常 `.env.local` 优先。建议把示例和非敏感默认值放 `.env`，把真实 API Key 放 `.env.local`。

### 数据库初始化流程

应用内部会自动执行等价于下面的逻辑：

```sql
CREATE TABLE IF NOT EXISTS portfolios (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 首次启动迁移

如果浏览器里还有历史 `localStorage` 数据，而 SQLite 里还没有内容，应用会自动把旧数据迁移到 SQLite。

这意味着：

- 老用户通常不需要手动迁移
- 新用户首次启动会直接用 SQLite

## 登录 / 鉴权机制说明

### 当前支持的方式

当前版本不提供真正的用户登录鉴权。

也就是说，现在没有：

- 用户注册
- 邮箱登录
- OAuth 登录
- 服务端 Session
- JWT 用户态
- 云端账号同步

### `/login` 页面现在是什么

`/login` 页面仍然存在，但只是一个提示页，用来说明：

- 当前版本已经停用登录入口
- 系统默认走本地 SQLite 持久化

相关页面：

- [app/login/page.tsx](./app/login/page.tsx)

### 那“userId” 是什么

项目内部仍然会生成一个本机设备维度的 `userId`，用于把本地数据写入 SQLite 的 `portfolios` 表。

这个 `userId`：

- 不是账号
- 不是登录身份
- 不需要用户感知
- 只是本地存储层的隔离键

简单说，它更像“这台设备上的本地数据命名空间”。

## 本地非登录模式怎么使用

这是当前默认使用方式。

### 使用体验

打开首页后，你可以直接：

- 添加股票
- 添加买入 / 卖出 / 分红记录
- 修改手续费配置
- 导出 / 导入备份

整个过程不需要登录。

### 数据保存在哪里

主要数据保存在：

- 本地 SQLite：`data/finance.sqlite`

同时浏览器侧仍会保留一份本地缓存，用于初始化兜底与迁移：

- `localStorage`

但当前主存储路径已经是 SQLite。

### 换浏览器 / 换机器会怎么样

默认情况下不会自动同步。

因为当前是本地优先模式，所以：

- 换机器不会自动带过去
- 清空本地文件后数据不会自动恢复
- 需要依赖 JSON 备份文件手动迁移

### 推荐操作习惯

如果你准备长期使用，建议：

- 定期导出 JSON 备份
- 保留 SQLite 文件副本
- 在升级或迁移设备前先做一次导出

## 行情与估值数据

### 当前支持的数据源

- Tencent Finance
- Yahoo Finance
- Stooq
- Alpha Vantage
- Manual fallback

### 使用方式

- 价格行情优先走现有行情服务链路
- 估值字段当前优先通过 Yahoo 补齐

### 当前估值字段

详情页目前支持展示：

- `PE(TTM)`
- `EPS(TTM)`
- `PB`
- `总市值`

### 文案含义

估值卡片里的状态含义如下：

- `暂无数据`：当前数据源没有返回该字段
- `不适用`：该字段不适合当前资产类型，例如 ETF / 基金
- `亏损`：`PE(TTM)` 所依赖的 TTM 每股收益小于等于 0

## 手续费与收益计算

### 当前收益模型

- 已实现收益：基于 FIFO 计算
- 浮动盈亏：基于当前持仓与实时价格
- 总收益：已实现收益 + 浮动盈亏

### 当前手续费逻辑

项目已经针对当前版本整理了自动费率逻辑：

- 普通 A 股股票：佣金 + 过户费；卖出再加印花税
- A 股 ETF：默认不收印花税，自动手续费逻辑已单独处理
- 港股：佣金 + 印花税 + 结算费

默认配置在：

- [config/defaults.ts](./config/defaults.ts)

核心计算在：

- [lib/finance.ts](./lib/finance.ts)

## 常用命令

```bash
# 启动开发环境
npm run dev

# 运行测试
npm test

# 生产构建
npm run build

# 生产启动
npm run start
```

## 目录结构

```text
finance_sys/
├── app/                    # Next.js App Router
├── components/             # 页面组件与弹窗
├── config/                 # 默认配置与数据源映射
├── hooks/                  # 自定义 Hooks
├── lib/                    # 核心业务逻辑与 SQLite 存储
├── store/                  # Zustand 状态管理
├── tests/                  # 单元测试
├── types/                  # 类型定义
└── data/                   # 本地 SQLite 文件目录（运行时生成）
```

## 开源说明

如果你准备把这个项目开源给其他人使用，当前 README 建议传达的真实信息是：

- 这是一个本地优先项目
- 不要求登录
- 本地 SQLite 会自动初始化
- 默认不会云同步
- 数据导出 / 导入是迁移和备份的主要方式

这样用户预期会更稳定，不会误以为它已经是一个带账号系统的在线产品。

## 后续可继续完善

- 为开源用户补一份 `.env.example`
- 增加 License
- 增加截图或 GIF 演示
- 增加“如何备份 / 如何迁移数据”专门章节
- 增加“如何发布桌面版 / Docker 版”文档
