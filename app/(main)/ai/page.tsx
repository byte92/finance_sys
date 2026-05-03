'use client'

import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import PageHeader from '@/components/layout/PageHeader'
import PortfolioAnalysisCard from '@/components/ai/PortfolioAnalysisCard'
import AiStockNavigator from '@/components/ai/AiStockNavigator'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

export default function AiPage() {
  const { t } = useI18n()

  return (
    <div className="min-h-screen">
      <PageHeader
        title={t('AI 分析中心')}
        description={t('集中查看组合摘要、挑选标的进入深度分析，并管理 AI 投研入口。')}
      />

      <div className="px-4 py-6 lg:px-6 space-y-6">
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">{t('AI 对话')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('围绕持仓、未持仓标的、交易复盘和风险管理进行连续问答。')}</div>
          </div>
          <Link href="/ai/chat">
            <Button type="button">
              <MessageCircle className="mr-2 h-4 w-4" />
              {t('进入对话')}
            </Button>
          </Link>
        </section>
        <PortfolioAnalysisCard />
        <AiStockNavigator />
      </div>
    </div>
  )
}
