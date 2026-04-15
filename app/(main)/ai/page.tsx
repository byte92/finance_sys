'use client'

import PageHeader from '@/components/layout/PageHeader'
import PortfolioAnalysisCard from '@/components/ai/PortfolioAnalysisCard'
import AiStockNavigator from '@/components/ai/AiStockNavigator'

export default function AiPage() {
  return (
    <div className="min-h-screen">
      <PageHeader
        title="AI 分析中心"
        description="集中查看组合摘要、挑选个股进入深度分析，并管理 AI 投研入口。"
      />

      <div className="px-4 py-6 lg:px-6 space-y-6">
        <PortfolioAnalysisCard />
        <AiStockNavigator />
      </div>
    </div>
  )
}
