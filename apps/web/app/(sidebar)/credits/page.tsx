"use client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import React from "react";
import { Sora } from "next/font/google";

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
});

function CreditsPage() {
  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-border/50 bg-card/30 overflow-hidden">
        <div className="flex flex-col md:flex-row">
          <div className="flex-1 flex flex-col items-center justify-center p-8 md:p-10 border-b md:border-b-0 md:border-r border-border/50">
            <span className="text-xs font-medium tracking-[0.15em] uppercase text-muted-foreground/60 mb-3">
              Credits (Free)
            </span>
            <h1 className={`text-5xl font-bold ${sora.className}`}>
              Free to use
            </h1>
            <span className="text-sm text-muted-foreground mt-2">
              No payment required
            </span>
          </div>

          <div className="flex-1 p-8 md:p-10">
            <h2
              className={`text-lg font-semibold mb-5 ${sora.className}`}
            >
              Thumbnaily
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              This is a free AI thumbnail generator. Simply describe your thumbnail and generate instantly.
            </p>
            <Link href="/app">
              <Button className="w-full rounded-xl bg-red-600 hover:bg-red-700 text-white border-0">
                Start Generating
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreditsPage;