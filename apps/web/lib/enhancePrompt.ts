import OpenAI from "openai";

export async function enhancePrompt(
  userPrompt: string,
  _image_urls: string[] = []
) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const prompt = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  return prompt.choices[0]?.message?.content || "";
}
