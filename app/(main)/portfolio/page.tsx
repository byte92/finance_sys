'use client'

import PageHeader from '@/components/layout/PageHeader'
import HoldingsList from '@/components/portfolio/HoldingsList'
import { useI18n } from '@/lib/i18n'

export default function PortfolioPage() {
  const { t } = useI18n()

  return (
    <div className="min-h-screen">
      <PageHeader
        title={t('持仓')}
        description={t('集中查看当前持仓、成本和盈亏，并进入资产详情。')}
      />

      <div className="px-4 py-6 lg:px-6">
        <HoldingsList />
      </div>
    </div>
  )
}
