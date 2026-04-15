import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'StockTracker - 股票交易盈亏追踪',
  description: '记录每一笔股票交易，实时统计盈亏，支持A股手续费自动计算',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
