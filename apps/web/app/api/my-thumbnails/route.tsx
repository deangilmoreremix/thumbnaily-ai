import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  // Without auth, just return public thumbnails
  const { data: thumbnails, error } = await supabase
    .from("thumbnails")
    .select("link, createdAt")
    .eq("isPublic", true)
    .order("createdAt", { ascending: false });
  
  if (error) {
    return NextResponse.json({ error: "Failed to fetch thumbnails" }, { status: 500 });
  }

  return NextResponse.json({ thumbnails });
}