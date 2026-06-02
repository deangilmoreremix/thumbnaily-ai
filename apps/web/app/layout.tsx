import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Toaster } from "sonner";
import NextTopLoader from "nextjs-toploader";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Thumbnaily — AI Thumbnail Generator",
  description:
    "Generate scroll-stopping thumbnails in seconds with AI. No design skills needed.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const twitterImagePath =
    "thumbnails/assets/Screenshot+2025-06-07+at+17.36.39.png";
  const twitterImageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/thumbnails/${twitterImagePath}`
    : null;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        {twitterImageUrl && (
          <>
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:site" content="@codeanuragg" />
            <meta name="twitter:title" content="Thumbnaily — AI Thumbnail Generator" />
            <meta
              name="twitter:description"
              content="Generate scroll-stopping thumbnails in seconds with AI."
            />
            <meta name="twitter:image" content={twitterImageUrl} />
          </>
        )}
      </head>
      <body className={`${outfit.className} antialiased`}>
        <NextTopLoader color="#DC2626" />
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
