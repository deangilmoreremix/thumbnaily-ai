"use client";
import { Loader2, Download } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { Sora } from "next/font/google";

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
});

interface Thumbnail {
  id: string;
  link: string;
  prompt: string;
  createdAt: string;
}

const CACHE_KEY = "recent-thumbnails";

export default function RecentThumbnails() {
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getThumbnails() {
      try {
        const response = await fetch("/api/explore?limit=20");
        const json = await response.json();
        setThumbnails(json.data || []);
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(json.data));
      } catch (error) {
        console.error("Failed to fetch thumbnails:", error);
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          setThumbnails(JSON.parse(cached));
        }
      } finally {
        setLoading(false);
      }
    }
    getThumbnails();
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 md:py-14">
      <div className="mb-8">
        <h1
          className={`text-2xl md:text-3xl font-bold tracking-tight ${sora.className}`}
        >
          Recently Generated
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Your recently generated thumbnails.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && thumbnails.length === 0 && (
        <div className="text-center py-20">
          <p className="text-muted-foreground">
            No thumbnails yet. Go generate some!
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {thumbnails.map((t) => (
          <div
            key={t.id}
            className="group relative rounded-xl overflow-hidden border border-border/50"
          >
            <Image
              src={t.link}
              width={1920}
              height={1080}
              alt="Thumbnail"
              className="w-full"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200 flex items-end justify-between p-3">
              <span className="text-xs text-white/0 group-hover:text-white/70 transition-colors duration-200">
                {new Date(t.createdAt).toLocaleDateString()}
              </span>
              <Link
                href={t.link}
                target="_blank"
                className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              >
                <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center hover:bg-white transition-colors">
                  <Download className="h-3.5 w-3.5 text-black" />
                </div>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}