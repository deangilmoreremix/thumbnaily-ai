"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Key, Check, Eye, EyeOff,AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "thumbnaily.openai_api_key";

interface ApiKeySettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ApiKeySettings({ open, onOpenChange }: ApiKeySettingsProps) {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (open) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setKey(saved);
      setMessage(null);
    }
  }, [open]);

  const validateKey = (k: string) => /^sk-[A-Za-z0-9_-]{20,}$/.test(k.trim());

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const trimmed = key.trim();

    if (!trimmed) {
      localStorage.removeItem(STORAGE_KEY);
      setMessage({ type: "success", text: "API key removed" });
      setSaving(false);
      onOpenChange(false);
      return;
    }

    if (!validateKey(trimmed)) {
      setMessage({ type: "error", text: "Invalid OpenAI API key format. Expected sk-... with 20+ chars." });
      setSaving(false);
      return;
    }

    try {
      const testRes = await fetch("/api/validate-openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenAI-Key": trimmed },
      });

      if (testRes.ok) {
        localStorage.setItem(STORAGE_KEY, trimmed);
        setMessage({ type: "success", text: "API key saved and verified" });
        setTimeout(() => onOpenChange(false), 600);
      } else {
        const j = await testRes.json().catch(() => ({ error: "Invalid key" }));
        setMessage({ type: "error", text: j.error ?? "Key validation failed" });
      }
    } catch {
      setMessage({ type: "error", text: "Could not reach validation endpoint" });
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    localStorage.removeItem(STORAGE_KEY);
    setKey("");
    setMessage({ type: "success", text: "API key removed" });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className="relative w-full max-w-md rounded-xl border border-border/60 bg-background shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            <h2 className="text-sm font-semibold">OpenAI API Key</h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Your API key is stored locally in your browser and sent directly to OpenAI from Thumbnaily&apos;s
            servers. Thumbnaily does not store or log your key.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">API Key</label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setMessage(null);
                }}
                placeholder="sk-..."
                className="pr-9 font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {message && (
            <div
              className={cn(
                "flex items-start gap-2 text-xs px-3 py-2 rounded-md",
                message.type === "success"
                  ? "bg-green-500/10 text-green-600 border border-green-500/20"
                  : "bg-red-500/10 text-red-600 border border-red-500/20"
              )}
            >
              {message.type === "error" && <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
              {message.type === "success" && <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={save}
              disabled={saving || !key.trim()}
              className="flex-1"
            >
              {saving ? "Verifying…" : "Save Key"}
            </Button>
            {key && (
              <Button
                size="sm"
                variant="outline"
                onClick={remove}
                className="text-muted-foreground"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
