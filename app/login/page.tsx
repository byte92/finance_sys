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
  const { user, loading, authEnabled, signInWithOtp, verifyEmailOtp, error } = useAuth()
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSentTo, setOtpSentTo] = useState('')
  const [localError, setLocalError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    if (!loading && user) {
      router.replace('/')
    }
  }, [loading, user, router])

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    setSuccessMessage('')

    if (!email) {
      setLocalError('请输入邮箱')
      return
    }

    setSubmitting(true)
    try {
      await signInWithOtp(email, `${window.location.origin}/`)
      setOtpSentTo(email)
      setSuccessMessage('验证码已发送到邮箱，请输入6位验证码完成登录')
    } catch (_) {
      // Error is handled in hook
    } finally {
      setSubmitting(false)
    }
  }

  const OTP_MIN_LEN = 6
  const OTP_MAX_LEN = 8

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    setSuccessMessage('')

    if (!otpSentTo || !otp) {
      setLocalError('请输入邮箱验证码')
      return
    }

    if (!new RegExp(`^\\d{${OTP_MIN_LEN},${OTP_MAX_LEN}}$`).test(otp)) {
      setLocalError(`验证码格式错误，请输入${OTP_MIN_LEN}-${OTP_MAX_LEN}位数字`)
      return
    }

    setSubmitting(true)
    try {
      await verifyEmailOtp(otpSentTo, otp)
      router.replace('/')
    } catch (_) {
      // Error is handled in hook
    } finally {
      setSubmitting(false)
    }
  }

  if (!authEnabled) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm border-border bg-card p-6">
          <div className="text-sm text-muted-foreground mb-3">当前未启用登录（游客模式）。</div>
          <Button onClick={() => router.replace('/')} className="w-full">
            直接进入系统
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-border bg-card p-6">
        <div className="text-lg font-semibold mb-1">登录</div>
        <div className="text-xs text-muted-foreground mb-4">
          先发送验证码到邮箱，再输入验证码完成登录
        </div>

        <form onSubmit={handleSendOtp} className="space-y-4">
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

          {(localError || error) && (
            <p className="text-xs text-destructive">{localError || error}</p>
          )}
          {successMessage && <p className="text-xs text-profit">{successMessage}</p>}

          <Button type="submit" className="w-full" disabled={submitting || !email}>
            {submitting ? '发送中...' : '发送邮箱验证码'}
          </Button>
        </form>

        {otpSentTo && (
          <form onSubmit={handleVerifyOtp} className="space-y-4 mt-4 pt-4 border-t border-border">
            <div className="space-y-1.5">
              <Label htmlFor="email-otp">邮箱验证码</Label>
              <Input
                id="email-otp"
                type="text"
                inputMode="numeric"
                placeholder={`请输入${OTP_MIN_LEN}-${OTP_MAX_LEN}位数字验证码`}
                value={otp}
                maxLength={OTP_MAX_LEN}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, OTP_MAX_LEN))}
                required
              />
            </div>
            <div className="text-[11px] text-muted-foreground">验证码已发送至：{otpSentTo}</div>
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || otp.length < OTP_MIN_LEN || otp.length > OTP_MAX_LEN}
            >
              {submitting ? '验证中...' : '验证并登录'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
