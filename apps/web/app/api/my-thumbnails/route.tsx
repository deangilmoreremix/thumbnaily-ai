import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  // For anonymous usage, return empty thumbnails
  // In production, you might want to track by IP or implement anonymous history
  return NextResponse.json({
    thumbnails: []
  });
}