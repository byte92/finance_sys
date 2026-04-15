'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BriefcaseBusiness, LayoutDashboard, Menu, Settings, Sparkles, Sun, Moon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'
import { useCurrency } from '@/hooks/useCurrency'
import { useStockStore } from '@/store/useStockStore'

const NAV_ITEMS = [
  { href: '/', label: '总览', icon: LayoutDashboard, match: (pathname: string) => pathname === '/' },
  { href: '/portfolio', label: '持仓', icon: BriefcaseBusiness, match: (pathname: string) => pathname === '/portfolio' || pathname.startsWith('/stock/') },
  { href: '/ai', label: 'AI', icon: Sparkles, match: (pathname: string) => pathname.startsWith('/ai') },
  { href: '/settings', label: '设置', icon: Settings, match: (pathname: string) => pathname.startsWith('/settings') },
] as const

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { theme, toggleTheme, mounted } = useTheme()
  const { displayCurrency, setDisplayCurrency } = useCurrency()
  const { init } = useStockStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-card/70 backdrop-blur-md">
          <SidebarContent
            pathname={pathname}
            displayCurrency={displayCurrency}
            setDisplayCurrency={setDisplayCurrency}
            mounted={mounted}
            theme={theme}
            toggleTheme={toggleTheme}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-md lg:hidden">
            <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
            <div className="text-sm font-semibold">StockTracker</div>
            <div className="ml-auto text-xs text-muted-foreground">本地优先</div>
          </div>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="relative h-full w-72 max-w-[85vw] border-r border-border bg-card shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <div className="text-sm font-semibold">StockTracker</div>
              <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <SidebarContent
              pathname={pathname}
              displayCurrency={displayCurrency}
              setDisplayCurrency={setDisplayCurrency}
              mounted={mounted}
              theme={theme}
              toggleTheme={toggleTheme}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function SidebarContent({
  pathname,
  displayCurrency,
  setDisplayCurrency,
  mounted,
  theme,
  toggleTheme,
}: {
  pathname: string
  displayCurrency: string
  setDisplayCurrency: (currency: 'CNY' | 'HKD' | 'USD' | 'USDT') => void
  mounted: boolean
  theme: 'dark' | 'light'
  toggleTheme: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-5">
        <div className="text-sm font-semibold">StockTracker</div>
        <div className="mt-1 text-xs text-muted-foreground">持仓、交易与 AI 投研助手</div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                active
                  ? 'bg-primary/12 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-border px-4 py-4 space-y-3">
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">显示货币</div>
          <select
            value={displayCurrency}
            onChange={(e) => e.target.value && setDisplayCurrency(e.target.value as 'CNY' | 'HKD' | 'USD' | 'USDT')}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="CNY">CNY</option>
            <option value="HKD">HKD</option>
            <option value="USD">USD</option>
            <option value="USDT">USDT</option>
          </select>
        </div>

        {mounted && (
          <Button variant="outline" className="w-full justify-start" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            {theme === 'dark' ? '切换亮色' : '切换暗色'}
          </Button>
        )}

        <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          本地优先模式，数据保存在当前设备的 SQLite 中。
        </div>
      </div>
    </div>
  )
}
