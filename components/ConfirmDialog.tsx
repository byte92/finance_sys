'use client'

import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void | Promise<void>
  onOpenChange: (open: boolean) => void
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  const { t } = useI18n()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>
        <div className="px-5 pb-5 pt-4">
          {description && (
            <p className="max-w-[34ch] text-sm leading-6 text-muted-foreground">{description}</p>
          )}
          <DialogFooter className="mt-5 border-t border-border pt-4">
            <Button className="min-w-20" variant="outline" onClick={() => onOpenChange(false)}>
              {cancelText ?? t('取消')}
            </Button>
            <Button className="min-w-20" variant="destructive" onClick={onConfirm}>
              {confirmText ?? t('确认')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
