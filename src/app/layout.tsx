import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Forge App',
  description: 'Built with Forge',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
