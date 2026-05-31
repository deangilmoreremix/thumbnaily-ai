"use client";
import { Sora } from "next/font/google";
import { User } from "lucide-react";

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
});

export default function AccountPage() {
  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-border/50 bg-card/30 p-8 text-center">
          <div className="flex justify-center mb-5">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
          </div>

          <h1 className={`text-xl font-bold tracking-tight ${sora.className}`}>
            Anonymous User
          </h1>

          <div className="mt-1.5 text-sm text-muted-foreground">
            No account required - using anonymously
          </div>

          <div className="mt-8 pt-6 border-t border-border/50">
            <p className="text-sm text-muted-foreground">
              You are using thumbnaily.ai without an account.
              Your generated thumbnails are not saved to a personal history.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}