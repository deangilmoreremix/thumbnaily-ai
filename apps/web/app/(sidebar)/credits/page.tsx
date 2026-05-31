"use client";
import { Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Sora } from "next/font/google";
import { appCache } from "@/lib/cache";

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
});

const CACHE_KEY = "credits";

function CreditsPage() {
  const cached = appCache.get<number>(CACHE_KEY);

  const [credits, setCredits] = useState<number>(cached ?? 100);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    if (cached !== undefined) return;
    async function fetchCredits() {
      setLoading(true);
      try {
        const response = await fetch("/api/getcredits");
        const data = await response.json();
        const c = data.credits ?? 100;
        setCredits(c);
        appCache.set(CACHE_KEY, c);
      } catch {
        setCredits(100);
      }
      setLoading(false);
    }
    fetchCredits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-border/50 bg-card/30 overflow-hidden">
        <div className="flex flex-col md:flex-row">
          <div className="flex-1 flex flex-col items-center justify-center p-8 md:p-10 border-b md:border-b-0 md:border-r border-border/50">
            <span className="text-xs font-medium tracking-[0.15em] uppercase text-muted-foreground/60 mb-3">
              Current Balance
            </span>
            <h1 className={`text-5xl font-bold ${sora.className}`}>
              {loading ? (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              ) : (
                credits
              )}
            </h1>
            <span className="text-sm text-muted-foreground mt-2">
              credits available
            </span>
            <p className="text-xs text-muted-foreground/50 mt-4 text-center">
              1 credit = 1 thumbnail
            </p>
          </div>

          <div className="flex-1 p-8 md:p-10 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Anonymous usage - no payment required
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreditsPage;