// API endpoint for image enhancement using OpenAI image API
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
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
  imageUrl?: string,
  error?: string,
) => {
  progressStore.set(progressId, { step, progress, imageUrl, error });
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type EnhancementType = 'upscale' | 'background_removal' | 'face_enhance' | 'ghibli_style' | 'outpaint';

function getEnhancementPrompt(enhancementType: EnhancementType, userPrompt?: string): string {
  const prompts: Record<EnhancementType, string> = {
    upscale: "Upscale this image to higher resolution while maintaining quality and detail",
    background_removal: "Remove the background from this image, keeping only the subject with transparency",
    face_enhance: "Enhance facial features in this image, making them clearer and more detailed",
    ghibli_style: "Transform this image into Studio Ghibli style artwork - vibrant colors, soft lighting, whimsical and magical",
    outpaint: userPrompt || "Extend the image beyond its original boundaries creatively",
  };
  return prompts[enhancementType] || prompts.upscale;
}

async function enhanceImage(imageUrl: string, enhancementType: EnhancementType, prompt?: string): Promise<string> {
  // Fetch the image as a buffer
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
  }
  const imageBuffer = await imageResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imageBuffer).toString('base64');

  const enhancementPrompt = getEnhancementPrompt(enhancementType, prompt);

  const response = await openai.images.edit({
    model: "gpt-image",
    image: imageBase64,
    prompt: enhancementPrompt,
    n: 1,
    size: "1024x576",
  });

  if (!response.data?.[0]?.url) {
    throw new Error("Image enhancement failed - no URL returned");
  }

  return response.data[0].url;
}

export async function POST(req: NextRequest) {
  const progressId = Math.random().toString(36).substring(7);
  updateProgress(progressId, "Initializing", 0);

  try {
    const { imageUrl, enhancementType, prompt } = await req.json();

    if (!imageUrl) {
      updateProgress(progressId, "Error", 10, undefined, "Image URL is required");
      return NextResponse.json(
        { error: true, message: "Image URL is required", progressId },
        { status: 400 }
      );
    }

    if (!enhancementType) {
      updateProgress(progressId, "Error", 10, undefined, "Enhancement type is required");
      return NextResponse.json(
        { error: true, message: "Enhancement type is required", progressId },
        { status: 400 }
      );
    }

    (async () => {
      try {
        updateProgress(progressId, `Applying ${enhancementType} enhancement`, 30);

        const resultUrl = await enhanceImage(imageUrl, enhancementType, prompt);

        updateProgress(progressId, "Downloading enhanced image", 60);
        const imageResponse = await fetch(resultUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download enhanced image: ${imageResponse.statusText}`);
        }
        const imageBuffer = await imageResponse.arrayBuffer();

        updateProgress(progressId, "Uploading to storage", 80);

        const key = `thumbnails/enhanced/${Date.now().toString()}_${Math.floor(Math.random() * 1000)}.png`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from('thumbnails')
          .upload(key, Buffer.from(imageBuffer), {
            contentType: 'image/png',
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        const { data: publicUrlData } = supabaseAdmin.storage
          .from('thumbnails')
          .getPublicUrl(key);

        updateProgress(progressId, "Complete", 100, publicUrlData.publicUrl);
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : "Enhancement failed";
        updateProgress(progressId, "Error", 100, undefined, errorMessage);
      } finally {
        setTimeout(() => progressStore.delete(progressId), 60000);
      }
    })();

    return NextResponse.json({ progressId });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "Failed to process request";
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
    return NextResponse.json({ error: "Progress ID required" }, { status: 400 });
  }

  const progress = progressStore.get(progressId);
  if (!progress) {
    return NextResponse.json({ error: "Invalid progress ID" }, { status: 404 });
  }

  return NextResponse.json(progress);
}