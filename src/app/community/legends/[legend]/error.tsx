"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

// Renders when something in the legend profile page throws after the
// route has matched. Without this file, an unhandled throw bubbles up
// to Next's default error → which the user sees as the same generic
// "page could not be found" 404 the missing-legend path produces, so
// real errors get misdiagnosed as routing problems.
export default function LegendProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-16 text-center">
      <h1 className="font-display text-2xl font-semibold text-white">
        Couldn&apos;t load this legend page
      </h1>
      <p className="text-sm text-slate-400">
        Something went wrong while building the profile. The error has been
        logged.
        {error.digest ? (
          <span className="ml-1 font-mono text-xs text-slate-500">
            (ref: {error.digest})
          </span>
        ) : null}
      </p>
      <div className="flex justify-center gap-3 pt-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="secondary">
          <Link href="/community/meta">Back to legend meta</Link>
        </Button>
      </div>
    </div>
  );
}
