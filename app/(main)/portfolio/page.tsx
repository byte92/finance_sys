'use client'

import PageHeader from '@/components/layout/PageHeader'
import HoldingsList from '@/components/portfolio/HoldingsList'

export default function PortfolioPage() {
  return (
    <div className="min-h-screen">
      <PageHeader
        title="持仓"
        description="集中查看当前持仓、成本和盈亏，并进入资产详情。"
      />

      <div className="px-4 py-6 lg:px-6">
        <HoldingsList />
      </div>
    </div>
  )
}
