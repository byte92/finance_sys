'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const { user, loading, signIn, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isSupabaseConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  useEffect(() => {
    if (!loading && user) {
      router.replace('/')
    }
  }, [loading, user, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')

    if (!email || !password) {
      setLocalError('请输入邮箱和密码')
      return
    }

    setSubmitting(true)
    try {
      await signIn(email, password)
      router.replace('/')
    } catch (_) {
      // Error is handled in hook
    } finally {
      setSubmitting(false)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm border-border bg-card p-6">
          <div className="text-sm text-muted-foreground">未配置 Supabase 环境变量，无法登录。</div>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-border bg-card p-6">
        <div className="text-lg font-semibold mb-1">登录</div>
        <div className="text-xs text-muted-foreground mb-4">
          测试账号：leo.langjun@gmail.com / 123123
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="login-email">邮箱</Label>
            <Input
              id="login-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="login-password">密码</Label>
            <Input
              id="login-password"
              type="password"
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {(localError || error) && (
            <p className="text-xs text-destructive">{localError || error}</p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? '登录中...' : '登录'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
