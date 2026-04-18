"use client";

import { NextStudio } from "next-sanity/studio";

import config from "../../../../sanity.config";

export default function StudioPage() {
  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-slate-200">
        Sanity is not configured yet. Add the Sanity env vars from `.env.example`
        before opening the embedded studio.
      </div>
    );
  }

  return <NextStudio config={config} />;
}
