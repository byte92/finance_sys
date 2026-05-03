'use client'

import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LOCALE_OPTIONS } from '@/lib/i18n/messages'
import { useI18n } from '@/lib/i18n'

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n()
  const currentIndex = LOCALE_OPTIONS.findIndex((item) => item.value === locale)
  const nextLocale = LOCALE_OPTIONS[(currentIndex + 1) % LOCALE_OPTIONS.length]?.value ?? 'zh-CN'
  const currentOption = LOCALE_OPTIONS.find((item) => item.value === locale) ?? LOCALE_OPTIONS[0]

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? 'icon' : 'sm'}
      className={compact
        ? 'h-9 w-9 rounded-lg border border-border/70 text-muted-foreground hover:text-foreground'
        : 'h-9 gap-2 rounded-lg border border-border/70 px-3 text-muted-foreground hover:text-foreground'}
      onClick={() => setLocale(nextLocale)}
      title={t('切换语言')}
      aria-label={t('切换语言')}
    >
      <Languages className="h-4 w-4" />
      {!compact && <span className="text-xs">{currentOption.label}</span>}
      {compact && <span className="sr-only">{currentOption.label}</span>}
    </Button>
  )
}
