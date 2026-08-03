import React from 'react'
import Header from '@/components/Header'
import { AuthBootstrap } from '@/components/providers/auth-bootstrap'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthBootstrap>
      <Header />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {children}
      </main>
    </AuthBootstrap>
  )
}
