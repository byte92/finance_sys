'use client'

import { useState } from 'react'
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AuthModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  error?: string | null
  signIn: (email: string, password: string) => Promise<unknown>
  signUp: (email: string, password: string) => Promise<unknown>
}

export default function AuthModal({ open, onOpenChange, signIn, signUp, error }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')

  const reset = () => {
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setLocalError('')
  }

  const handleClose = () => {
    reset()
    onOpenChange(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')

    if (!email || !password) {
      setLocalError('请输入邮箱和密码')
      return
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setLocalError('两次密码不一致')
      return
    }

    setLoading(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        await signUp(email, password)
      }
      handleClose()
    } catch (_) {
      // Error is handled in hook
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{mode === 'signin' ? '登录' : '注册'}</DialogTitle>
        <DialogClose onClick={handleClose} />
      </DialogHeader>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="auth-email">邮箱</Label>
            <Input
              id="auth-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-password">密码</Label>
            <Input
              id="auth-password"
              type="password"
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <Label htmlFor="auth-confirm">确认密码</Label>
              <Input
                id="auth-confirm"
                type="password"
                placeholder="再次输入密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          )}

          {(localError || error) && (
            <p className="text-xs text-destructive">{localError || error}</p>
          )}

          <DialogFooter className="justify-between">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin')
                setLocalError('')
              }}
            >
              {mode === 'signin' ? '没有账号？注册' : '已有账号？登录'}
            </button>
            <Button type="submit" disabled={loading}>
              {loading ? '处理中...' : mode === 'signin' ? '登录' : '注册'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
