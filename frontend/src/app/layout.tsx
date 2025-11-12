import './globals.css'
import React from 'react'
import Header from '@/components/Header'

export const metadata = {
  title: 'Aion',
  description: 'Modular Analytics App',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Header />
        <div className="max-w-7xl mx-auto p-6">
          {children}
        </div>
      </body>
    </html>
  )
}
