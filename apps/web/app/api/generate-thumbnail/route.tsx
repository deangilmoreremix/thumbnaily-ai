// API endpoint for thumbnail generation using OpenAI image API via OpenRouter
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { enhancePrompt } from "@/lib/enhancePrompt";
import { supabaseAdmin } from "@/lib/supabase";

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
  data?: Partial<Omit<ProgressData, 'step' | 'progress'>>,
) => {
  progressStore.set(progressId, { 
    step, 
    progress, 
    ...data,
  } as ProgressData);
};

const BUCKET_NAME = 'thumbnails';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

async function generateImage(prompt: string): Promise<Buffer> {
  const response = await openai.chat.completions.create({
    model: "openai/gpt-5-image",
    modalities: ["image", "text"],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    ],
  });

  // Extract image URL from response (images are returned as base64 data URLs)
  const imageUrl = response.choices[0]?.message?.images?.[0]?.image_url?.url;

  if (!imageUrl) {
    throw new Error("Image generation failed - no image returned");
  }

  // If it's a base64 data URL, decode it to get the buffer
  if (imageUrl.startsWith('data:')) {
    const base64Data = imageUrl.split(',')[1];
    return Buffer.from(base64Data, 'base64');
  }

  // Otherwise fetch the image from URL
  const mediaResponse = await fetch(imageUrl);
  if (!mediaResponse.ok) {
    throw new Error(`Failed to download generated image: ${mediaResponse.statusText}`);
  }
  
  return Buffer.from(await mediaResponse.arrayBuffer());
}

export async function POST(req: NextRequest) {
  const progressId = Math.random().toString(36).substring(7);
  updateProgress(progressId, "Initializing", 0);

  try {
    const { basicPrompt, image_url, image_urls, isPublic } = await req.json();

    // Normalise image URLs: prefer the array, fall back to single, default empty
    const imageUrls: string[] = Array.isArray(image_urls)
      ? image_urls.filter((u): u is string => typeof u === "string" && Boolean(u))
      : image_url
        ? [image_url]
        : [];

    if (imageUrls.length > 5) {
      updateProgress(progressId, "Error", 15, { error: "Max 5 reference images allowed" });
      return NextResponse.json(
        { error: true, message: "You can upload up to 5 reference images", progressId },
        { status: 400 }
      );
    }

    if (!basicPrompt) {
      updateProgress(progressId, "Error", 15, { error: "Prompt is missing" });
      return NextResponse.json(
        { error: true, message: "Prompt is required", progressId },
        { status: 400 }
      );
    }

    updateProgress(progressId, "Request accepted", 15);

    // Start async generation
    (async () => {
      try {
        updateProgress(progressId, "Enhancing prompt", 25);

        const enhancedPromptResponse = await enhancePrompt(basicPrompt, imageUrls);
        if (!enhancedPromptResponse) {
          throw new Error("Failed to enhance prompt: empty response");
        }
        const { prompt: enhancedContent, style, mood } = JSON.parse(enhancedPromptResponse);
        if (!enhancedContent) {
          throw new Error("Failed to parse enhanced prompt");
        }
        
        // Combine style and mood into the prompt
        const finalPrompt = `[Style: ${style || 'cinematic'}, Mood: ${mood || 'dramatic'}] ${enhancedContent}`;
        updateProgress(progressId, "Prompt enhanced", 35);

        updateProgress(progressId, "Generating image", 50);

        const mediaBuffer = await generateImage(finalPrompt);

        updateProgress(progressId, "Uploading to cloud storage", 80);
        
        const key = `thumbnails/generations/${Date.now().toString()}_${Math.floor(Math.random() * 1000)}.png`;
        
        const { error: uploadError } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .upload(key, mediaBuffer, {
            contentType: 'image/png',
            upsert: false,
          });

        if (uploadError) {
          throw new Error(`Failed to upload to Supabase Storage: ${uploadError.message}`);
        }

        const { data: publicUrlData } = supabaseAdmin.storage
          .from(BUCKET_NAME)
          .getPublicUrl(key);

        const finalUrl = publicUrlData.publicUrl;
        updateProgress(progressId, "Cloud upload complete", 90);
        updateProgress(progressId, "Complete", 100, { imageUrl: finalUrl });
        console.log("Done");
      } catch (e: unknown) {
        console.error("Background generation error:", e);
        const errorMessage =
          e instanceof Error ? e.message : "Unknown error during generation";
        updateProgress(progressId, "Error", 100, { error: errorMessage });
      } finally {
        setTimeout(() => progressStore.delete(progressId), 60000);
      }
    })();

    return NextResponse.json({ progressId });
  } catch (e: unknown) {
    console.error("Initial request processing error:", e);
    const errorMessage =
      e instanceof Error ? e.message : "Failed to process request";
    updateProgress(progressId, "Error", 0, { error: `Initial error: ${errorMessage}` });
    return NextResponse.json(
      { error: true, message: errorMessage, progressId },
      { status: 500 }
    );
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