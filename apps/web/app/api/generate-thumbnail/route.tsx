// api/generate-thumbnail/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { enhancePrompt } from "@/lib/enhancePrompt";
import { supabase } from "@/lib/supabase";

interface ProgressData {
  step: string;
  progress: number;
  imageUrl?: string;
  error?: string;
}

const progressStore = new Map<string, ProgressData>();

const updateProgress = (
  progressId: string,
  step: string,
  progress: number,
  imageUrl?: string,
  error?: string
) => {
  progressStore.set(progressId, { step, progress, imageUrl, error });
};

export async function POST(req: NextRequest) {
  const progressId = Math.random().toString(36).substring(7);
  updateProgress(progressId, "Initializing", 0);

  try {
    const { basicPrompt, image_url, image_urls, isPublic } = await req.json();
    const publicFlag = typeof isPublic === "boolean" ? isPublic : true;

    // Normalise image URLs: prefer the array, fall back to single, default empty
    const imageUrls: string[] = Array.isArray(image_urls)
      ? image_urls.filter((u): u is string => typeof u === "string" && Boolean(u))
      : image_url
        ? [image_url]
        : [];

    if (imageUrls.length > 5) {
      updateProgress(progressId, "Error", 15, undefined, "Max 5 reference images allowed");
      return NextResponse.json(
        { error: true, message: "You can upload up to 5 reference images", progressId },
        { status: 400 }
      );
    }

    if (!basicPrompt) {
      updateProgress(progressId, "Error", 15, undefined, "Prompt is missing");
      return NextResponse.json(
        { error: true, message: "Prompt is required", progressId },
        { status: 400 }
      );
    }

    updateProgress(progressId, "Enhancing prompt", 25);

    const enhancedPromptResponse = await enhancePrompt(basicPrompt, imageUrls);
    if (!enhancedPromptResponse) {
      throw new Error("Failed to enhance prompt: empty response");
    }
    const { prompt: enhancedContent } = JSON.parse(enhancedPromptResponse);
    if (!enhancedContent) {
      throw new Error("Failed to parse enhanced prompt");
    }
    updateProgress(progressId, "Prompt enhanced", 35);

    updateProgress(progressId, "Generating thumbnail with AI", 60);

    // Generate image using OpenAI Responses API
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: enhancedContent },
            ...imageUrls.map((url) => ({
              type: "input_image" as const,
              detail: "high" as const,
              image_url: url,
            })),
          ],
        },
      ],
      tools: [{ type: "image_generation" }],
    });

if (!response.output || !response.output[0] || response.output[0].type !== "image_generation_call") {
      throw new Error("AI generation failed or returned no output");
    }

    const imageUrl = (response.output[0] as { url?: string }).url;
    if (!imageUrl) {
      throw new Error("No image URL in response");
    }

    updateProgress(progressId, "Downloading generated image", 80);
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download generated image: ${imageResponse.statusText}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();

    updateProgress(progressId, "Uploading to Supabase storage", 85);

    if (!supabase) {
      throw new Error("Supabase client not initialized");
    }

    const key = `thumbnails/generations/${Date.now()}-${Math.floor(Math.random() * 1000)}.png`;
    const { error: uploadError } = await supabase.storage
      .from("thumbnails")
      .upload(key, Buffer.from(imageBuffer), {
        contentType: "image/png",
      });

    if (uploadError) {
      throw new Error(`Failed to upload to Supabase: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage.from("thumbnails").getPublicUrl(key);
    const finalImageUrl = publicUrlData.publicUrl;

    updateProgress(progressId, "Cloud upload complete", 90);

    // Save to database via Supabase
    const { error: dbError } = await supabase.from("thumbnails").insert({
      link: finalImageUrl,
      prompt: enhancedContent,
      isPublic: publicFlag,
    });

    if (dbError) {
      console.error("Database error:", dbError);
    }

    updateProgress(progressId, "Complete", 100, finalImageUrl);
    console.log("Done");

    return NextResponse.json({ progressId });
  } catch (e: unknown) {
    console.error("Request processing error:", e);
    const errorMessage =
      e instanceof Error ? e.message : "Failed to process request";
    updateProgress(progressId, "Error", 0, undefined, `Error: ${errorMessage}`);
    return NextResponse.json(
      { error: true, message: errorMessage, progressId },
      { status: 500 }
    );
  } finally {
    setTimeout(() => progressStore.delete(progressId), 60000);
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const progressId = url.searchParams.get("progressId");

  if (!progressId) {
    return NextResponse.json(
      { error: "Progress ID is required" },
      { status: 400 }
    );
  }
  if (!progressStore.has(progressId)) {
    return NextResponse.json(
      { error: "Invalid or expired progress ID" },
      { status: 404 }
    );
  }

  return NextResponse.json(progressStore.get(progressId));
}