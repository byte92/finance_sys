'use client'

import PageHeader from '@/components/layout/PageHeader'
import AiHistoryView from '@/components/ai/AiHistoryView'
import { useI18n } from '@/lib/i18n'

export default function AiHistoryPage() {
  const { t } = useI18n()

  return (
    <div className="min-h-screen">
      <PageHeader
        title={t('AI 分析历史')}
        description={t('查看已保存的组合与标的 AI 分析结果，按类型、日期和信心标签筛选，并用热力图观察节奏变化。')}
      />

      <div className="px-4 py-6 lg:px-6">
        <AiHistoryView />
      </div>
    </div>
  )
}
