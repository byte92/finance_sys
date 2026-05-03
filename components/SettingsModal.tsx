'use client'

import { X } from 'lucide-react'
import SettingsContent from '@/components/SettingsContent'
import { useI18n } from '@/lib/i18n'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useI18n()

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-4xl rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t('设置与数据管理')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t('调整默认市场、手续费规则，并管理本地备份')}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-secondary transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5">
          <SettingsContent onSaved={onClose} onCancel={onClose} compact />
        </div>
      </div>
    </div>
  )
}
