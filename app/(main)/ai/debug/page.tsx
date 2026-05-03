'use client'

import { Suspense } from 'react'
import PageHeader from '@/components/layout/PageHeader'
import AiDebugView from '@/components/ai/AiDebugView'
import { useI18n } from '@/lib/i18n'

export default function AiDebugPage() {
  const { t } = useI18n()

  return (
    <div className="min-h-screen">
      <PageHeader
        title="AI Debug"
        description={t('用对话 ID、消息 ID 或 Run ID 查询完整调用链路、上下文统计和 Raw Debug Tree。')}
      />

      <div className="px-4 py-6 lg:px-6">
        <Suspense fallback={<div className="text-sm text-muted-foreground">{t('正在加载 Debug 面板...')}</div>}>
          <AiDebugView />
        </Suspense>
      </div>
    </div>
  )
}
