'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root

const DialogHeader = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('flex items-center justify-between border-b border-border p-5', className)}>
    {children}
  </div>
)

const DialogTitle = ({ children }: { children: React.ReactNode }) => (
  <DialogPrimitive.Title className="text-base font-semibold">{children}</DialogPrimitive.Title>
)

const DialogContent = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <DialogPrimitive.Content
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl outline-none',
        className,
      )}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
)

const DialogFooter = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('flex justify-end gap-2 pt-1', className)}>{children}</div>
)

const DialogClose = ({ onClick }: { onClick?: () => void }) => (
  <DialogPrimitive.Close asChild>
    <button onClick={onClick} className="rounded-md p-1 transition-colors hover:bg-secondary">
      <X className="h-4 w-4 text-muted-foreground" />
    </button>
  </DialogPrimitive.Close>
)

export { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter, DialogClose }
