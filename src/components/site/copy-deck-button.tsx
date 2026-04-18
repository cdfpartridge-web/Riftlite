"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function CopyDeckButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2200);
    }
  }

  return (
    <Button onClick={handleCopy} size="sm" variant="secondary">
      {state === "copied" ? "✓ Copied!" : state === "error" ? "Failed — try again" : "Copy deck text"}
    </Button>
  );
}
