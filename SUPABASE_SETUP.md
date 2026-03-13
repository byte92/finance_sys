# Supabase 集成指南

本项目已集成 Supabase 云端数据库，支持多设备同步和自动备份。

## 功能特性

- ✅ 多设备实时同步
- ✅ 自动数据备份
- ✅ 离线降级（连接失败时使用 localStorage）
- ✅ 同步状态可视化
- ✅ 免费额度：500MB 数据库存储 + 2GB 文件存储

## 快速开始

### 1. 创建 Supabase 项目

1. 访问 [Supabase](https://supabase.com) 并注册/登录
2. 点击 "New Project" 创建新项目
3. 设置项目名称和数据库密码（请记住密码）
4. 等待项目创建完成（约 1-2 分钟）

### 2. 运行 SQL 脚本创建表

在 Supabase Dashboard 中，进入 SQL Editor，运行以下脚本：

```sql
-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 用户表（用于多设备识别）
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_sync_at TIMESTAMP WITH TIME ZONE
);

-- 股票表
CREATE TABLE IF NOT EXISTS stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('A', 'HK', 'US', 'FUND', 'CRYPTO')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, code, market)
);

-- 交易表
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL', 'DIVIDEND')),
  date TEXT NOT NULL,
  price NUMERIC NOT NULL,
  quantity NUMERIC NOT NULL,
  commission NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL,
  net_amount NUMERIC NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 配置表
CREATE TABLE IF NOT EXISTS app_config (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  config JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_stocks_user ON stocks(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_stock ON trades(stock_id);
CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(date);

-- 启用实时订阅
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE stocks;
ALTER PUBLICATION supabase_realtime ADD TABLE trades;

-- 设置行级安全策略（RLS）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- 允许所有操作（根据需要可以更严格）
CREATE POLICY "Users can manage their own data" ON users
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Stocks can manage their own data" ON stocks
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Trades can manage their own data" ON trades
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Config can manage their own data" ON app_config
  FOR ALL USING (true) WITH CHECK (true);
```

### 3. 获取 API 凭据

1. 在 Supabase Dashboard 中，进入 **Settings > API**
2. 复制以下值：
   - `Project URL`
   - `anon public` key

### 4. 配置环境变量

复制 `.env.local.example` 为 `.env.local`：

```bash
cp .env.local.example .env.local
```

然后编辑 `.env.local`，填入你的 Supabase 凭据：

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 5. 迁移现有数据（可选）

如果你已有 localStorage 数据，可以通过以下方式迁移：

```bash
# 启动开发服务器
npm run dev
```

在浏览器控制台运行：

```javascript
// 获取 localStorage 数据
const data = JSON.parse(localStorage.getItem('stock-tracker-storage'))
const deviceId = localStorage.getItem('finance-sys-device-id')

// 发送到迁移 API
fetch('/api/migrate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    deviceId: deviceId || crypto.randomUUID(),
    stocks: data.stocks,
    config: data.config
  })
}).then(r => r.json()).then(console.log)
```

### 6. 重启开发服务器

```bash
npm run dev
```

应用会自动连接到 Supabase 并开始同步。

## 使用说明

### 同步状态

在顶部导航栏可以看到同步状态：

- 🟢 **已同步** - 数据已与云端同步
- 🔵 **同步中...** - 正在同步数据
- 🔴 **同步失败** - 同步出错，使用离线模式
- ⚪️ **离加载** - 从云端加载数据

### 多设备同步

1. 在设备 A 上添加股票/交易
2. 在设备 B 上打开应用
3. 设备 B 会自动显示设备 A 的数据

### 离线模式

- 网络断开时，应用自动降级到 localStorage
- 数据变化暂时保存在本地
- 网络恢复后，重新同步

## 数据库表结构

| 表名 | 用途 | 说明 |
|------|------|------|
| `users` | 用户管理 | 每个设备一个 user，通过 device_id 识别 |
| `stocks` | 股票信息 | 存储股票基本信息 |
| `trades` | 交易记录 | 关联到 stock_id，存储所有交易 |
| `app_config` | 应用配置 | 存储手续费配置等 |

## 故障排查

### 连接失败

1. 检查 `.env.local` 是否正确配置
2. 确认 Supabase 项目未暂停
3. 检查网络连接
4. 查看浏览器控制台错误信息

### 同步失败

1. 确认已运行 SQL 脚本创建表
2. 检查 RLS 策略是否正确
3. 查看 Supabase Dashboard 的日志

### 数据不一致

1. 在 Supabase Dashboard 中直接查看数据
2. 使用导出功能备份数据
3. 清空 localStorage 重新加载

## 成本

Supabase 免费计划：

- 500MB 数据库存储
- 2GB 文件存储
- 50K API 请求/月
- 1GB 带宽/月
- 无限实时订阅

对于个人投资记录，免费额度完全够用。

## 账号认证（Supabase Auth）

本系统已集成 Supabase Auth，支持用户注册、登录和登出。

### 功能特性



- ✅ 邮箱密码登录
- ✅ 用户注册
- ✅ Session 持久化（7 天有效期）
- ✅ 多设备登录同一账号
- ✅ 账号数据完全隔离
- ✅ 自动刷新 token

### 数据库 RLS 配置

在 Supabase Dashboard SQL Editor 中执行：

```sql
-- 更新 stocks 表 RLS 策略
DROP POLICY IF EXISTS "Stocks can manage their own data" ON stocks;
CREATE POLICY "Users can only access their own stocks" ON stocks
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 更新 trades 表 RLS 策略
DROP POLICY IF EXISTS "Trades can manage their own data" ON trades;
CREATE POLICY "Users can only access their own trades" ON trades
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM stocks
      WHERE stocks.id = trades.stock_id
      AND stocks.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM stocks
      WHERE stocks.id = trades.stock_id
      AND stocks.user_id = auth.uid()
    )
  );

-- 更新 app_config 表 RLS 策略
DROP POLICY IF EXISTS "Config can manage their own data" ON app_config;
CREATE POLICY "Users can only access their own config" ON app_config
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### 数据迁移（从旧 device_id 到新 Auth）

如果之前使用过本系统，需要迁移旧数据到新账号：

1. 获取旧设备 ID：
   ```javascript
   const deviceId = localStorage.getItem('finance-sys-device-id')
   console.log('Device ID:', deviceId)
   ```

2. 注册/登录新账号

3. 在浏览器控制台执行迁移：
   ```javascript
   const { migrateToDeviceIdUser } = await import('/lib/migrate-to-auth.js')
   await migrateToDeviceIdUser(deviceId)
   ```

4. 刷新页面查看迁移的数据

### 备份/恢复旧数据

如果迁移脚本无法使用，可以通过导出/导入功能：

1. 在更新前的版本中点击"导出"保存 JSON 文件
2. 在新版本中点击"导入"加载保存的数据

## 安全建议

生产环境建议：

1. 使用更严格的 RLS 策略（已配置）
2. 启用邮箱验证（在 Supabase Dashboard > Authentication 开启）
3. 定期备份数据
4. 设置数据库访问限制
5. 启用双因素认证（可选）

## 相关链接

- [Supabase 官方文档](https://supabase.com/docs)
- [Supabase JavaScript 客户端](https://supabase.com/docs/reference/javascript)
- [Next.js 环境变量](https://nextjs.org/docs/basic-features/environment-variables)
