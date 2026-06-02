"use client";

import AppSidebar from "@/components/app-sidebar";
import React, { useState } from "react";
import { Menu as MenuIcon, X as XIcon } from "lucide-react";

export default function SidebarLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <AppSidebar
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="p-3 md:hidden sticky top-0 bg-background z-10 flex items-center border-b border-border/50">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {isMobileMenuOpen ? (
              <XIcon size={20} />
            ) : (
              <MenuIcon size={20} />
            )}
          </button>
        </div>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}