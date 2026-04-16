'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const AI_TABS = [
  {
    href: '/ai',
    label: '分析中心',
    match: (pathname: string) => pathname === '/ai',
  },
  {
    href: '/ai/history',
    label: '分析历史',
    match: (pathname: string) => pathname.startsWith('/ai/history'),
  },
] as const

export default function AiSubnav() {
  const pathname = usePathname()

  return (
    <div className="border-b border-border bg-card/40 px-4 lg:px-6">
      <div className="flex gap-2 overflow-x-auto py-3">
        {AI_TABS.map((tab) => {
          const active = tab.match(pathname)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border/70 bg-background text-muted-foreground hover:border-primary/20 hover:text-foreground'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
