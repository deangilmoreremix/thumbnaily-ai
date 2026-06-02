import Footer from '@/components/Footer'
import Navbar from '@/components/Navbar'
import Link from 'next/link'
import React from 'react'

export default function Pricing() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex flex-1 flex-col items-center justify-center p-6 py-16">

        <h1 className="text-4xl font-bold mb-2">Thumbnaily</h1>
        <p className="text-muted-foreground mb-8 text-center max-w-2xl">
          Free AI-powered thumbnail generator. Simply describe what you want and generate stunning thumbnails in seconds.
        </p>

        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-border/50 shadow-lg px-6 py-8 flex flex-col items-center">
            <h2 className="text-xl font-bold mb-3">Free Tier</h2>
            <p className="text-muted-foreground text-sm mb-6 text-center">
              Unlimited thumbnails with no registration required
            </p>
            
            <Link
              href="/app"
              className="w-full text-center py-3 px-6 rounded-xl font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              Start Generating
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}