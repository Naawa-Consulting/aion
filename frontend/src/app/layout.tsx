import './globals.css'
import React from 'react'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { LocaleProvider } from '@/components/providers/locale-provider'
import { Toaster } from 'sonner'

export const metadata = {
  title: 'Aion',
  description: 'Modular Analytics App',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <LocaleProvider>
            {children}
            <Toaster richColors position="top-right" closeButton duration={4000} />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
