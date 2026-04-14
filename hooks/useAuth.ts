'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

function toFriendlyAuthError(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const message = raw.toLowerCase()

  if (
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('econnreset') ||
    message.includes('timeout')
  ) {
    return '无法连接认证服务，请检查网络、代理或稍后重试'
  }

  if (message.includes('invalid login credentials')) {
    return '邮箱或密码错误，请确认后重试'
  }

  if (message.includes('email not confirmed')) {
    return '邮箱尚未验证，请先前往邮箱完成验证'
  }

  return raw || '登录失败，请稍后重试'
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load session on mount
  useEffect(() => {
    const loadSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) throw error
        setUser(session?.user ?? null)
      } catch (err) {
        console.error('Failed to load session:', err)
        setError(toFriendlyAuthError(err))
      } finally {
        setLoading(false)
      }
    }

    loadSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        setError(null)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Sign in with email and password
  const signIn = async (email: string, password: string) => {
    setError(null)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(toFriendlyAuthError(error))
      throw error
    }

    setUser(data.user)
    return data
  }

  // Send OTP / magic link to email
  const signInWithOtp = async (email: string, emailRedirectTo?: string) => {
    setError(null)
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo,
        shouldCreateUser: true,
      },
    })

    if (error) {
      setError(toFriendlyAuthError(error))
      throw error
    }

    return data
  }

  // Verify 6-digit email OTP code
  const verifyEmailOtp = async (email: string, token: string) => {
    setError(null)
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })

    if (error) {
      setError(toFriendlyAuthError(error))
      throw error
    }

    setUser(data.user ?? null)
    return data
  }

  // Sign up with email and password
  const signUp = async (email: string, password: string) => {
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      setError(toFriendlyAuthError(error))
      throw error
    }

    // Note: User might need to verify email before signing in
    // For now, we'll auto-sign them in
    if (data.user) {
      setUser(data.user)
    }

    return data
  }

  // Sign out
  const signOut = async () => {
    setError(null)
    const { error } = await supabase.auth.signOut()

    if (error) {
      setError(toFriendlyAuthError(error))
      throw error
    }

    setUser(null)
  }

  return {
    user,
    loading,
    error,
    signIn,
    signInWithOtp,
    verifyEmailOtp,
    signUp,
    signOut,
  }
}
