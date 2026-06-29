export function getOpenAIKey(req: Request): string {
  const headerKey = req.headers.get("x-openai-key");
  if (headerKey && headerKey.trim().length > 0) {
    return headerKey.trim();
  }
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey && envKey.trim().length > 0) {
    return envKey.trim();
  }
  return "";
}
