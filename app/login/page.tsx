'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-border bg-card p-6">
        <div className="text-lg font-semibold mb-2">登录入口已停用</div>
        <div className="text-sm text-muted-foreground mb-4">
          当前版本使用本地 SQLite 持久化，不再要求登录后才能进入系统。
        </div>
        <Link href="/" className="block">
          <Button className="w-full">返回首页</Button>
        </Link>
      </Card>
    </div>
  )
}
