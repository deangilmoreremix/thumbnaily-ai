import { NextRequest, NextResponse } from "next/server";
import { criticThumbnail } from "@/lib/thumbnailCritic";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      thumbnailId?: string;
      imageUrl?: string;
      prompt?: string | null;
      revisedPrompt?: string | null;
      persist?: boolean;
    };

    let imageUrl = body.imageUrl;
    let prompt = body.prompt ?? null;
    let revisedPrompt = body.revisedPrompt ?? null;

    if (body.thumbnailId) {
      const { data } = await supabase
        .from("thumbnails")
        .select("id, link, prompt, revised_prompt")
        .eq("id", body.thumbnailId)
        .single();
      if (!data) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      imageUrl = imageUrl ?? (data.link as string);
      prompt = prompt ?? (data.prompt as string | null);
      revisedPrompt = revisedPrompt ?? (data.revised_prompt as string | null);
    }

    if (!imageUrl) {
      return NextResponse.json({ error: "imageUrl or thumbnailId required" }, { status: 400 });
    }

    const result = await criticThumbnail({
      imageUrl,
      prompt,
      revisedPrompt,
    });
    if (!result) {
      return NextResponse.json({ error: "Critic failed" }, { status: 500 });
    }

    if (body.persist && body.thumbnailId) {
      await supabase
        .from("thumbnails")
        .update({
          critic_score: result.score,
          critic_notes: result.notes,
          critic_suggestions: result.suggestions,
          mood: result.mood,
          palette: result.palette,
          subject: result.subject,
          tags: result.tags,
        })
        .eq("id", body.thumbnailId);
    }

    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}