'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import { zhCN } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      locale={zhCN}
      showOutsideDays={showOutsideDays}
      className={cn('p-2', className)}
      classNames={{
        months: 'flex flex-col gap-4',
        month: 'space-y-4',
        caption: 'relative flex items-center justify-center pt-1',
        caption_label: 'text-sm font-medium text-foreground',
        nav: 'flex items-center gap-1',
        nav_button: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'h-8 w-8 rounded-md border border-border/70 bg-background p-0 text-muted-foreground hover:text-foreground'
        ),
        nav_button_previous: 'absolute left-1',
        nav_button_next: 'absolute right-1',
        table: 'w-full border-collapse space-y-1',
        head_row: 'flex',
        head_cell: 'w-9 rounded-md text-[11px] font-medium text-muted-foreground',
        row: 'mt-2 flex w-full',
        cell: 'relative h-9 w-9 p-0 text-center text-sm',
        day: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'h-9 w-9 rounded-md p-0 font-normal text-foreground aria-selected:opacity-100'
        ),
        day_selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        day_today: 'border border-primary/40 bg-primary/10 text-primary',
        day_outside: 'text-muted-foreground/40',
        day_disabled: 'text-muted-foreground/30 opacity-50',
        day_hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className, ...chevronProps }) =>
          orientation === 'left' ? (
            <ChevronLeft className={cn('h-4 w-4', className)} {...chevronProps} />
          ) : (
            <ChevronRight className={cn('h-4 w-4', className)} {...chevronProps} />
          ),
      }}
      {...props}
    />
  )
}

Calendar.displayName = 'Calendar'

export { Calendar }
