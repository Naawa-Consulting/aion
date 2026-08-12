import React from 'react'
import { AppShell } from '@/components/AppShell'
import { AuthBootstrap } from '@/components/providers/auth-bootstrap'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthBootstrap>
      <AppShell>{children}</AppShell>
    </AuthBootstrap>
  )
}
