import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03]",
        className,
      )}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)]" />
    </div>
  );
}
