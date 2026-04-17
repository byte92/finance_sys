'use client'

import PageHeader from '@/components/layout/PageHeader'
import MarketOverviewBoard from '@/components/market/MarketOverviewBoard'
import MarketAnalysisCard from '@/components/market/MarketAnalysisCard'

export default function MarketsPage() {
  return (
    <div className="min-h-screen">
      <PageHeader
        title="大盘指标"
        description="集中查看 A 股、港股和美股代表指数，并通过 AI 观察三地大盘的短中期节奏。"
      />

      <div className="px-4 py-6 lg:px-6 space-y-6">
        <MarketOverviewBoard />
        <MarketAnalysisCard />
      </div>
    </div>
  )
}
