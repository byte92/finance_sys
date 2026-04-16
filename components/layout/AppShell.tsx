'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BriefcaseBusiness, ChevronDown, ChevronLeft, ChevronRight, LayoutDashboard, Menu, Settings, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStockStore } from '@/store/useStockStore'

const NAV_ITEMS = [
  { href: '/', label: '总览', icon: LayoutDashboard, match: (pathname: string) => pathname === '/' },
  { href: '/portfolio', label: '持仓', icon: BriefcaseBusiness, match: (pathname: string) => pathname === '/portfolio' || pathname.startsWith('/stock/') },
] as const

const AI_SUB_ITEMS = [
  { href: '/ai', label: '分析中心', match: (pathname: string) => pathname === '/ai' },
  { href: '/ai/history', label: '分析历史', match: (pathname: string) => pathname.startsWith('/ai/history') },
] as const

const SIDEBAR_COLLAPSED_KEY = 'stock-tracker-sidebar-collapsed'
const AI_NAV_EXPANDED_KEY = 'stock-tracker-ai-nav-expanded'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { init } = useStockStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [aiNavExpanded, setAiNavExpanded] = useState(true)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    setSidebarCollapsed(stored === 'true')
    const aiStored = localStorage.getItem(AI_NAV_EXPANDED_KEY)
    setAiNavExpanded(aiStored === null ? true : aiStored === 'true')
  }, [])

  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  useEffect(() => {
    if (pathname.startsWith('/ai')) {
      setAiNavExpanded(true)
    }
  }, [pathname])

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((current) => {
      const next = !current
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  const toggleAiNavExpanded = () => {
    setAiNavExpanded((current) => {
      const next = !current
      localStorage.setItem(AI_NAV_EXPANDED_KEY, String(next))
      return next
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen">
        <aside
          className={`hidden lg:flex fixed inset-y-0 left-0 z-30 shrink-0 flex-col border-r border-border bg-card/70 backdrop-blur-md transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-20' : 'w-64'
          }`}
        >
          <SidebarContent
            pathname={pathname}
            collapsed={sidebarCollapsed}
            aiNavExpanded={aiNavExpanded}
            onToggleAiNavExpanded={toggleAiNavExpanded}
            onToggleCollapsed={toggleSidebarCollapsed}
          />
        </aside>

        <div className={`flex min-w-0 min-h-screen flex-1 flex-col transition-[padding-left] duration-200 ${sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'}`}>
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
              collapsed={false}
              aiNavExpanded={aiNavExpanded}
              onToggleAiNavExpanded={toggleAiNavExpanded}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function SidebarContent({
  pathname,
  collapsed,
  aiNavExpanded,
  onToggleAiNavExpanded,
  onToggleCollapsed,
}: {
  pathname: string
  collapsed: boolean
  aiNavExpanded: boolean
  onToggleAiNavExpanded?: () => void
  onToggleCollapsed?: () => void
}) {
  const aiSectionActive = pathname.startsWith('/ai')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className={`flex-1 min-h-0 overflow-y-auto space-y-1 py-4 ${collapsed ? 'px-2' : 'px-3'}`}>
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center rounded-lg py-2.5 text-sm transition-colors ${
                collapsed ? 'justify-center px-2' : 'gap-3 px-3'
              } ${
                active
                  ? 'bg-primary/12 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}

        <div className="space-y-1">
          <button
            type="button"
            onClick={onToggleAiNavExpanded}
            title={collapsed ? 'AI' : undefined}
            className={`flex w-full items-center rounded-lg py-2.5 text-sm transition-colors ${
              collapsed ? 'justify-center px-2' : 'gap-3 px-3'
            } ${
              aiSectionActive
                ? 'bg-primary/12 text-primary border border-primary/20'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">AI</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${aiNavExpanded ? 'rotate-0' : '-rotate-90'}`} />
              </>
            )}
          </button>

          {!collapsed && aiNavExpanded && (
            <div className="ml-3 space-y-1 border-l border-border/70 pl-3">
              {AI_SUB_ITEMS.map((item) => {
                const active = item.match(pathname)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </nav>

      <div className={`border-t border-border py-4 space-y-3 ${collapsed ? 'px-2' : 'px-4'}`}>
        <Link
          href="/settings"
          className={`flex items-center rounded-lg py-2.5 text-sm transition-colors ${
            collapsed ? 'justify-center px-2' : 'gap-3 px-3'
          } ${
            pathname.startsWith('/settings')
              ? 'bg-primary/12 text-primary border border-primary/20'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
          title={collapsed ? '设置' : undefined}
        >
          <Settings className="h-4 w-4" />
          {!collapsed && <span>设置</span>}
        </Link>

        {onToggleCollapsed && (
          <Button
            variant="ghost"
            className={`w-full border border-border/70 ${collapsed ? 'justify-center px-2' : 'justify-between'}`}
            onClick={onToggleCollapsed}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? (
              <>
                <ChevronRight className="h-4 w-4" />
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">收起侧边栏</span>
                <ChevronLeft className="h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
