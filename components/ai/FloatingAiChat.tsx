'use client'

import { useEffect, useState } from 'react'
import { Bot, MessageCircle } from 'lucide-react'
import AiChatPanel from '@/components/ai/AiChatPanel'
import { Button } from '@/components/ui/button'

export default function FloatingAiChat() {
  const [open, setOpen] = useState(false)
  const [scrolling, setScrolling] = useState(false)

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

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 z-40 flex h-[640px] max-h-[calc(100vh-7rem)] w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <AiChatPanel mode="floating" onClose={() => setOpen(false)} />
        </div>
      )}

      <Button
        type="button"
        size="icon"
        onClick={() => setOpen((current) => !current)}
        className={`fixed bottom-6 right-5 z-40 h-14 w-14 rounded-full shadow-2xl transition-all duration-300 ${
          scrolling && !open ? 'translate-x-9 scale-75 opacity-45' : 'translate-x-0 scale-100 opacity-100'
        }`}
        title="AI 对话"
      >
        {open ? <Bot className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </Button>
    </>
  )
}
