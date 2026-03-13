# StockTracker - 股价自动获取功能说明

## 功能特性

✅ **自动股价获取**：支持多数据源自动获取实时股价  
✅ **智能降级**：获取失败时自动切换到备用数据源  
✅ **缓存机制**：避免频繁请求，提升性能  
✅ **手动兜底**：自动获取失败时可手动输入价格  
✅ **可插拔架构**：轻松切换不同的数据提供商  

## 支持的数据源

### 1. Alpha Vantage (默认MVP方案) ⭐
- **类型**: 免费API
- **额度**: 5次/分钟, 500次/天
- **优势**: 全球市场支持好，稳定性高
- **劣势**: 请求频率限制较严格
- **注册**: https://www.alphavantage.co/support/#api-key

### 2. Yahoo Finance (备选)
- **类型**: 无需API Key
- **额度**: 较宽松
- **优势**: 完全免费，无配额限制
- **劣势**: 非官方API，可能不稳定

### 3. FinnHub (高级备选)
- **类型**: 免费额度较高
- **额度**: 60次/分钟
- **优势**: 请求限制宽松
- **劣势**: 需要注册

### 4. 手动输入 (Fallback)
- **类型**: 本地输入
- **优势**: 100%可靠
- **劣势**: 需要手动维护

## 快速开始

1. **获取API Key**：
   ```bash
   # 复制环境变量模板
   cp .env.example .env.local
   
   # 编辑文件，填入你的Alpha Vantage API Key
   ALPHA_VANTAGE_API_KEY=YOUR_KEY_HERE
   ```

2. **重启开发服务器**：
   ```bash
   npm run dev
   ```

3. **使用**：
   - 进入个股详情页
   - 系统会自动获取当前股价
   - 显示实时涨跌和浮动盈亏
   - 5分钟自动刷新一次

## 架构设计

```
hooks/useStockQuote.ts          # React Hook封装
app/api/stock/quote/route.ts    # Next.js API 代理
lib/StockPriceService.ts        # 核心服务类
lib/dataSources/                # 各数据源实现
  ├── AlphaVantageSource.ts
  ├── YahooFinanceSource.ts
  └── ManualSource.ts
config/dataSources.ts           # 数据源配置
types/stockApi.ts               # 类型定义
```

## 故障转移机制

1. 首先尝试默认数据源 (Alpha Vantage)
2. 失败则按顺序尝试备选源 (FinnHub → Yahoo → Manual)
3. 所有自动源失败后降级为手动输入模式
4. 支持缓存避免重复请求相同数据

## 自定义配置

在 `config/dataSources.ts` 中可以：
- 修改各数据源的请求频率限制
- 调整缓存时间
- 添加新的数据源实现
- 修改故障转移链顺序

## 未来扩展

- [ ] 接入付费数据源 (如Wind、同花顺等)
- [ ] 支持K线图数据获取
- [ ] 添加股价预警通知
- [ ] 实现WebSocket实时推送
