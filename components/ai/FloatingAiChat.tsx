'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bot, Sparkles } from 'lucide-react'
import AiChatPanel from '@/components/ai/AiChatPanel'

export default function FloatingAiChat() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [scrolling, setScrolling] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const pathname = usePathname()

  const closePanel = () => setOpen(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), 180)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const handleScroll = () => {
      setScrolling(true)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setScrolling(false), 380)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      closePanel()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  useEffect(() => {
    closePanel()
  }, [pathname])

  return (
    <>
      {mounted && (
        <div
          ref={panelRef}
          className={`fixed bottom-24 right-4 z-40 flex h-[640px] max-h-[calc(100vh-7rem)] w-[420px] max-w-[calc(100vw-2rem)] origin-bottom-right flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl transition-all duration-200 ease-out ${
            open ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-3 scale-95 opacity-0'
          }`}
        >
          <AiChatPanel mode="floating" onClose={closePanel} />
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`group fixed bottom-6 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300 ${
          scrolling && !open ? 'translate-x-9 scale-75 opacity-45' : 'translate-x-0 scale-100 opacity-100'
        }`}
      >
        {/* 外圈光晕 */}
        <span className="absolute inset-[-3px] rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400 opacity-60 blur-sm animate-pulse" />
        {/* 按钮主体 */}
        <span className="relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-700 shadow-lg shadow-purple-500/30 transition-shadow group-hover:shadow-purple-500/60">
          {open ? (
            <Bot className="h-5 w-5 text-white" />
          ) : (
            <Sparkles className="h-5 w-5 text-white" />
          )}
        </span>
        {/* hover 文案提示 */}
        <span className="pointer-events-none absolute right-16 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-card border border-border px-3 py-1.5 text-xs text-foreground shadow-lg opacity-0 translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
          AI 智能助手
        </span>
      </button>
    </>
  )
}
