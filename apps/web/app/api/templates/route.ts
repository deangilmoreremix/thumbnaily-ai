import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [{ data: templates }, { data: styles }] = await Promise.all([
      supabase
        .from("prompt_templates")
        .select("id, slug, name, category, description, prefix, suffix, example_prompt, recommended_size, recommended_quality")
        .order("sort_order", { ascending: true }),
      supabase
        .from("style_presets")
        .select("id, slug, name, description, prompt_fragment")
        .order("sort_order", { ascending: true }),
    ]);

    return NextResponse.json({
      templates: templates ?? [],
      styles: styles ?? [],
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}// trigger rebuild
// deploy trigger
// force rebuild after seed
