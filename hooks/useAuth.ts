'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

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
        setError(err instanceof Error ? err.message : '加载会话失败')
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
      setError(error.message)
      throw error
    }

    setUser(data.user)
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
      setError(error.message)
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
      setError(error.message)
      throw error
    }

    setUser(null)
  }

  return {
    user,
    loading,
    error,
    signIn,
    signUp,
    signOut,
  }
}
