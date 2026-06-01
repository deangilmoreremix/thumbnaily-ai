import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // For anonymous usage, return a default credit value
  // In production, you might want to track usage by IP or implement anonymous credits
  return NextResponse.json({
    credits: 100 // Default credits for anonymous users
  });
}