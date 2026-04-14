'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import { canUseSupabaseAuth } from '@/lib/auth/mode'
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
  const [loading, setLoading] = useState(canUseSupabaseAuth())
  const [error, setError] = useState<string | null>(null)
  const authEnabled = canUseSupabaseAuth()

  // Load session on mount
  useEffect(() => {
    if (!authEnabled || !supabase) {
      setLoading(false)
      setUser(null)
      setError(null)
      return
    }
    const client = supabase

    const loadSession = async () => {
      try {
        const { data: { session }, error } = await client.auth.getSession()
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
    const { data: { subscription } } = client.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        setError(null)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [authEnabled])

  // Sign in with email and password
  const signIn = async (email: string, password: string) => {
    if (!authEnabled || !supabase) {
      throw new Error('当前为游客模式，未启用登录')
    }
    const client = supabase
    setError(null)
    const { data, error } = await client.auth.signInWithPassword({
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
    if (!authEnabled || !supabase) {
      throw new Error('当前为游客模式，未启用登录')
    }
    const client = supabase
    setError(null)
    const { data, error } = await client.auth.signInWithOtp({
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
    if (!authEnabled || !supabase) {
      throw new Error('当前为游客模式，未启用登录')
    }
    const client = supabase
    setError(null)
    const { data, error } = await client.auth.verifyOtp({
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
    if (!authEnabled || !supabase) {
      throw new Error('当前为游客模式，未启用登录')
    }
    const client = supabase
    setError(null)
    const { data, error } = await client.auth.signUp({
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
    if (!authEnabled || !supabase) {
      setUser(null)
      return
    }
    const client = supabase
    setError(null)
    const { error } = await client.auth.signOut()

    if (error) {
      setError(toFriendlyAuthError(error))
      throw error
    }

    setUser(null)
  }

  return {
    user,
    loading,
    authEnabled,
    error,
    signIn,
    signInWithOtp,
    verifyEmailOtp,
    signUp,
    signOut,
  }
}
