'use client'

import PageHeader from '@/components/layout/PageHeader'
import AiChatPanel from '@/components/ai/AiChatPanel'

export default function AiChatPage() {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col overflow-hidden lg:h-screen">
      <PageHeader
        title="AI 对话"
        description="围绕当前持仓、交易复盘、股票估值和风险管理进行连续对话。"
      />

      <div className="min-h-0 flex-1 px-4 py-6 lg:px-6">
        <AiChatPanel mode="full" />
      </div>
    </div>
  )
}
