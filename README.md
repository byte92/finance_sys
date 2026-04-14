# StockTracker

> 一款为个人投资者设计的股票交易盈亏追踪工具，支持实时统计每一笔交易的盈亏情况，自动计算手续费，并提供整体持仓分析。

---

## 目录

- [产品介绍](#产品介绍)
- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [技术方案](#技术方案)
- [数据模型设计](#数据模型设计)
- [股价自动获取](#股价自动获取)
- [手续费计算模型](#手续费计算模型)
- [数据存储方案](#数据存储方案)
- [未来规划](#未来规划)
- [开源贡献](#开源贡献)

---

## 产品介绍

StockTracker 是一个开源股票交易记录与盈亏分析工具。MVP 以 **A股** 为核心，未来将逐步扩展支持港股、美股、基金、加密货币等资产类型。

当前采用 **Supabase Auth + SQLite 本地存储**：登录鉴权由 Supabase 提供，交易与配置数据持久化到本地 SQLite，并支持 JSON 格式一键导出备份。

**核心理念：**
- 本地优先，零隐私风险
- 数据结构开放，可随时迁移
- 费用精确计算，实际成本清晰可见
- 多市场可扩展，架构统一

---

## 功能特性

### 已实现（MVP v1.0）

**交易记录管理**
- 添加股票/资产（支持 A股、港股、美股、基金、加密货币）
- 每只股票记录多笔买入/卖出交易
- 手续费自动计算（含佣金、印花税、过户费）
- 手动输入备注记录交易理由和策略

**盈亏统计分析**
- FIFO（先进先出）方法计算已实现盈亏
- 实时浮动盈亏计算（输入当前价格或自动获取）
- 整体持仓统计（持仓数量、均成本、盈亏率）
- 总览仪表盘（跨股票汇总、盈亏对比柱状图）

**股价自动获取**
- 支持多数据源（Alpha Vantage、Yahoo Finance）
- 可插拔架构，随时切换或扩展数据源
- 智能降级：自动获取失败时回退到手动输入
- 5分钟缓存，避免频繁请求

**数据管理**
- SQLite（本地）持久化存储（按登录用户隔离）
- LocalStorage 本地缓存兜底
- 一键导出 JSON 格式备份文件
- 从 JSON 文件导入恢复数据
- 数据结构版本化，便于未来迁移

---

## 快速开始

### 环境要求

- Node.js 18+
- npm / yarn / pnpm

### 安装运行

```bash
# 克隆项目
git clone https://github.com/your-username/stock-tracker.git
cd stock-tracker

# 安装依赖
npm install

# 配置环境变量（可选，用于股价自动获取）
cp .env.example .env.local

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000 即可使用。

### 配置股价自动获取（可选）

编辑 `.env.local`，填入你的 Alpha Vantage API Key：

```env
ALPHA_VANTAGE_API_KEY=your_api_key_here
```

免费注册获取 API Key：https://www.alphavantage.co/support/#api-key
（免费版：5次/分钟，500次/天）

### 构建部署

```bash
# 生产构建
npm run build

# 启动生产服务器
npm run start
```

---

## 目录结构

```
stock-tracker/
│
├── app/                          # Next.js App Router
│   ├── globals.css               # 全局样式 + 设计系统 Token
│   ├── layout.tsx                # 根布局（SEO meta、字体）
│   └── page.tsx                  # 首页入口（懒加载 Dashboard）
│
├── components/                   # React 组件
│   ├── Dashboard.tsx             # 总览仪表盘（持仓列表、汇总统计、图表）
│   ├── StockDetail.tsx           # 个股详情（交易记录、盈亏曲线、实时价格）
│   ├── AddStockModal.tsx         # 添加股票/资产弹窗
│   ├── AddTradeModal.tsx         # 添加交易记录弹窗（含自动手续费计算）
│   └── ui/                       # 基础 UI 组件（Button、Card、Input 等）
│
├── config/                       # 应用配置
│   ├── defaults.ts               # 各市场默认手续费配置
│   └── dataSources.ts            # 股价数据源配置及代码映射表
│
├── docs/                         # 文档
│   └── PRICE_FETCHING.md         # 股价获取功能详细说明
│
├── hooks/                        # React 自定义 Hooks
│   └── useStockQuote.ts          # 股价获取 Hook（含缓存、自动刷新）
│
├── lib/                          # 核心业务逻辑
│   ├── finance.ts                # 盈亏计算（FIFO）、手续费公式、格式化工具
│   ├── utils.ts                  # 通用工具（cn 类名合并）
│   ├── StockPriceService.ts      # 股价服务主类（缓存、降级、多数据源）
│   └── dataSources/              # 股价数据源实现
│       ├── AlphaVantageSource.ts # Alpha Vantage 实现（推荐免费方案）
│       ├── YahooFinanceSource.ts # Yahoo Finance 实现（无需 Key）
│       └── ManualSource.ts       # 手动输入 Fallback
│
├── store/                        # 全局状态管理
│   └── useStockStore.ts          # Zustand Store（股票/交易 CRUD + 导入导出）
│
├── types/                        # TypeScript 类型定义
│   ├── index.ts                  # 核心数据模型（Stock、Trade、AppConfig 等）
│   └── stockApi.ts               # 股价数据源接口定义
│
├── .env.example                  # 环境变量模板
├── tailwind.config.ts            # Tailwind 配置（设计系统 Token）
├── next.config.mjs               # Next.js 配置
└── tsconfig.json                 # TypeScript 配置
```

---

## 技术方案

### 技术栈

| 层次 | 技术 | 选型理由 |
|------|------|----------|
| 框架 | Next.js 16 + React 19 | SSR/SSG 灵活支持，未来可接入 API Routes |
| 语言 | TypeScript | 类型安全，数据模型精确，重构友好 |
| 样式 | Tailwind CSS v3 + 设计系统 Token | 一致的视觉语言，深色金融风格 |
| 状态管理 | Zustand + persist | 轻量、无 boilerplate，配合 LocalStorage 持久化 |
| 图表 | Recharts | React 生态，声明式 API，盈亏曲线和对比柱状图 |
| 存储 | SQLite（better-sqlite3） + LocalStorage 缓存 | 轻量本地持久化，读写稳定，支持离线使用 |

### 设计系统

`app/globals.css` 中定义了完整的设计 Token，使用 HSL 色值，支持主题化：

```css
/* A股惯例：红涨绿跌 */
--profit: 4 90% 58%;       /* 盈利色（红色） */
--loss: 142 71% 45%;       /* 亏损色（绿色） */
--profit-muted: 4 60% 18%; /* 盈利背景色 */
--loss-muted: 142 50% 13%; /* 亏损背景色 */
```

所有组件通过语义化 Token（`profit-text`、`loss-badge` 等）引用颜色，无硬编码颜色值。

### 数据流架构

```
用户操作
  ↓
Components（AddTradeModal / Dashboard）
  ↓
useStockStore（Zustand）
  ↓
LocalStorage（自动持久化）
  ↓
calcStockSummary（lib/finance.ts 纯函数计算）
  ↓
UI 渲染
```

股价获取为独立链路：

```
StockDetail 组件
  ↓
useStockQuote Hook
  ↓
StockPriceService（缓存 + 降级）
  ↓
AlphaVantageSource / YahooFinanceSource / ManualSource
```

---

## 数据模型设计

数据模型采用 **云端迁移友好** 的设计，字段使用英文命名，所有主键使用 UUID，时间字段使用 ISO 8601 格式，便于未来直接对接 RESTful API 或数据库 ORM。

### 核心模型

```typescript
// 股票/资产
interface Stock {
  id: string           // UUID
  code: string         // 股票代码 (000001 / 00700 / AAPL)
  name: string         // 股票名称
  market: Market       // 'A' | 'HK' | 'US' | 'FUND' | 'CRYPTO'
  trades: Trade[]
  note?: string
  createdAt: string    // ISO 8601
  updatedAt: string
}

// 单笔交易
interface Trade {
  id: string
  stockId: string
  type: 'BUY' | 'SELL'
  date: string         // "2024-01-15"
  price: number        // 成交价格
  quantity: number     // 成交数量（股）
  commission: number   // 佣金
  tax: number          // 印花税 + 过户费
  totalAmount: number  // 成交金额（price × quantity）
  netAmount: number    // 实际金额（含/扣费用）
  note?: string
  createdAt: string
  updatedAt: string
}

// 手续费配置（每个市场独立可配）
interface FeeConfig {
  market: Market
  commissionRate: number    // 佣金率 (0.0003 = 万三)
  minCommission: number     // 最低佣金
  stampDutyRate: number     // 印花税率（卖出）
  transferFeeRate: number   // 过户费率（沪市）
}
```

### 导出格式

```json
{
  "meta": {
    "version": "1.0.0",
    "exportedAt": "2024-03-04T12:00:00.000Z",
    "appName": "StockTracker"
  },
  "config": { ... },
  "stocks": [ ... ]
}
```

---

## 股价自动获取

### 数据源优先级

| 优先级 | 提供商 | 类型 | 免费额度 | 备注 |
|--------|--------|------|----------|------|
| 1 | Alpha Vantage | 需要 API Key | 500次/天 | 推荐，稳定性好 |
| 2 | FinnHub | 需要 API Key | 60次/分钟 | 额度更宽松 |
| 3 | Yahoo Finance | 无需 Key | 较宽松 | 非官方，可能不稳定 |
| 4 | 手动输入 | 本地 | 无限制 | 最终降级方案 |

### 接入新数据源

实现 `StockDataSource` 接口即可：

```typescript
// 以新数据源为例
class MyCustomDataSource implements StockDataSource {
  provider = 'my-source' as const

  async getQuote(symbol: string, market: Market): Promise<StockQuote | null> {
    // 调用你的 API
    const data = await fetch(`https://my-api.com/quote/${symbol}`)
    return {
      symbol,
      price: data.price,
      change: data.change,
      // ...
    }
  }
  // ...
}

// 注册到服务
stockPriceService.sources.set('my-source', new MyCustomDataSource(config))
```

### 缓存机制

- 默认缓存时间：5分钟
- 缓存存储在内存中（页面刷新后失效）
- 支持强制刷新（跳过缓存）
- 支持速率限制保护，防止触发 API 封禁

---

## 手续费计算模型

### A股标准费率

| 费用项 | 触发时机 | 默认费率 | 说明 |
|--------|----------|----------|------|
| 佣金 | 买入 + 卖出 | 万三（0.03%） | 最低 5 元 |
| 印花税 | 仅卖出 | 千一（0.1%） | 国家税收 |
| 过户费 | 上交所股票 | 0.02‱ | 深交所不收 |

### 各市场费率配置

```
A股:    佣金万三(最低5元) + 印花税千一(卖出) + 沪市过户费
港股:   佣金万三(最低50港币) + 印花税 0.13%(买卖均收) + 结算费
美股:   默认零佣金（可配置）
基金:   申购费 0.1%
加密货币: 交易手续费 0.1%
```

所有费率均可在设置中修改，存储于 `AppConfig.feeConfigs`。

---

## 未来规划

### v1.1 - 数据增强

- [ ] 批量从券商 CSV 导出文件导入交易记录
- [ ] 手续费配置 UI（可视化修改各市场费率）
- [ ] 交易记录编辑功能（当前只支持删除）
- [ ] 备注支持 Markdown 格式

### v1.2 - 分析增强

- [ ] 盈亏日历视图（按月/日查看每日盈亏）
- [ ] 持仓成本线叠加在 K 线图上
- [ ] 交易胜率统计（盈利笔数 / 总笔数）
- [ ] 最大回撤计算
- [ ] 行业/板块分布饼图

### v1.3 - 价格增强

- [ ] 接入更多 A 股行情数据源（如腾讯/新浪免费接口）
- [ ] 实现 WebSocket 实时价格推送
- [ ] 价格预警通知（跌破成本线提醒）
- [ ] 历史 K 线图展示（TradingView Lightweight Charts）

### v2.0 - 云端同步

- [ ] SQLite 多端同步策略（可选云端中转）
- [ ] 账号注册 + 多设备数据同步
- [ ] 数据加密存储
- [ ] 数据迁移工具（LocalStorage → Cloud）

### v2.x - 扩展市场

- [ ] 港股完整支持（AH 溢价计算）
- [ ] 美股分红追踪
- [ ] ETF 净值数据
- [ ] 可转债价格追踪
- [ ] 融资融券记录

### 付费数据源备选方案

| 提供商 | 适用场景 | 定价参考 |
|--------|----------|----------|
| Wind API | 专业机构，A 股全量数据 | 按需询价 |
| 聚合数据 | 国内 A 股实时行情 | 约¥99/月 |
| Polygon.io | 美股专业级数据 | $29/月起 |
| FinnHub Pro | 全球市场实时数据 | $50/月 |

---

## 开源贡献

欢迎提交 Issue 和 Pull Request！

### 本地开发

```bash
git clone https://github.com/your-username/stock-tracker.git
cd stock-tracker
npm install
npm run dev
```

### 贡献方向

- 新增数据源（实现 `StockDataSource` 接口）
- 新增市场类型支持
- 优化手续费计算逻辑
- 改善 UI/UX 交互体验
- 编写单元测试

### 技术决策原则

1. **本地优先**：默认不依赖任何云服务
2. **渐进增强**：新功能以可选方式接入，不破坏现有使用方式
3. **类型安全**：所有新代码必须有完整的 TypeScript 类型
4. **零硬编码**：颜色、费率、配置均通过设计系统或配置文件管理

---

## License

MIT License © 2024 StockTracker Contributors
