'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type DatePickerProps = {
  id?: string
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  allowClear?: boolean
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
  allowClear = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const { locale, t } = useI18n()

  const selectedDate = useMemo(() => {
    if (!value) return undefined
    try {
      return parseISO(value)
    } catch {
      return undefined
    }
  }, [value])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-10 w-full justify-between rounded-md border-input bg-surface px-3 text-sm font-normal text-foreground',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">
            {selectedDate
              ? locale === 'zh-CN'
                ? format(selectedDate, 'yyyy年M月d日', { locale: zhCN })
                : format(selectedDate, 'MMM d, yyyy')
              : (placeholder ?? t('选择日期'))}
          </span>
          <CalendarDays className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="rounded-xl bg-card p-2">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              if (!date) return
              onChange(format(date, 'yyyy-MM-dd'))
              setOpen(false)
            }}
            initialFocus
          />
          {allowClear && value && (
            <div className="border-t border-border px-2 pb-1 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-center text-muted-foreground hover:text-foreground"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                {t('清除日期')}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
