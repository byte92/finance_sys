import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'StockTracker - 投资交易盈亏追踪',
  description: '记录股票、基金、加密资产交易，实时统计盈亏与手续费',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
