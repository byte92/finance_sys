'use client'

import { Button } from '@/components/ui/button'
import PageHeader from '@/components/layout/PageHeader'
import PortfolioSummarySection from '@/components/portfolio/PortfolioSummarySection'
import HoldingsList from '@/components/portfolio/HoldingsList'
import PortfolioAnalysisCard from '@/components/ai/PortfolioAnalysisCard'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/lib/i18n'

export default function OverviewPage() {
  const router = useRouter()
  const { t } = useI18n()

  return (
    <div className="min-h-screen">
      <PageHeader
        title={t('总览')}
        description={t('查看组合整体收益、风险分布，以及 AI 投研摘要。')}
        actions={
          <Button size="sm" variant="outline" onClick={() => router.push('/portfolio')}>
            {t('进入持仓页')}
          </Button>
        }
      />

      <div className="px-4 py-6 lg:px-6 space-y-8">
        <PortfolioSummarySection />
        <PortfolioAnalysisCard compact />
        <HoldingsList limit={5} showAddButton={false} title={t('持仓预览')} description={t('展示前 5 个持仓，便于快速进入详情或转到完整持仓页。')} />
      </div>
    </div>
  )
}
