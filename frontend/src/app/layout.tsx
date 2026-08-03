import './globals.css'
import React from 'react'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { Toaster } from 'sonner'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

export const metadata = {
  title: 'Aion',
  description: 'Modular Analytics App',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <ThemeProvider>
          {children}
          <Toaster richColors position="top-right" closeButton duration={4000} />
        </ThemeProvider>
      </body>
    </html>
  )
}
