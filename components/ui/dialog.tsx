'use client'

import * as React from 'react'
import { X } from 'lucide-react'

const Dialog = ({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) => {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => onOpenChange(false)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

const DialogHeader = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`flex items-center justify-between border-b border-border p-5 ${className}`}>
    {children}
  </div>
)

const DialogTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-base font-semibold">{children}</h2>
)

const DialogContent = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`p-5 ${className}`}>{children}</div>
)

const DialogFooter = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`flex gap-2 justify-end pt-1 ${className}`}>{children}</div>
)

const DialogClose = ({ onClick }: { onClick: () => void }) => (
  <button onClick={onClick} className="rounded-md p-1 hover:bg-secondary transition-colors">
    <X className="h-4 w-4 text-muted-foreground" />
  </button>
)

export { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter, DialogClose }
