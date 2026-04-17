'use client'

import PageHeader from '@/components/layout/PageHeader'
import SettingsContent from '@/components/SettingsContent'

export default function SettingsPage() {
  return (
    <div className="min-h-screen">
      <PageHeader
        title="设置"
        description="管理默认市场、费率、本地数据备份，以及 AI provider / model / token 配置。"
      />

      <div className="px-4 py-6 lg:px-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <SettingsContent />
        </div>
      </div>
    </div>
  )
}
