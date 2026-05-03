'use client'

import PageHeader from '@/components/layout/PageHeader'
import AiChatPanel from '@/components/ai/AiChatPanel'
import { useI18n } from '@/lib/i18n'

export default function AiChatPage() {
  const { t } = useI18n()

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col overflow-hidden lg:h-screen">
      <PageHeader
        title={t('AI 对话')}
        description={t('围绕当前持仓、交易复盘、估值和风险管理进行连续对话。')}
      />

      <div className="min-h-0 flex-1 px-4 py-6 lg:px-6">
        <AiChatPanel mode="full" />
      </div>
    </div>
  )
}
