import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });
  }

  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ success: false });
  }

  const { error } = await supabase
    .from("waitlist_users")
    .insert({ email });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}