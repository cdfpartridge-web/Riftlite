import { Skeleton } from "@/components/site/skeleton";

export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-20 px-6 py-14">
      <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full max-w-xl" />
          <div className="flex gap-4">
            <Skeleton className="h-12 w-40 rounded-full" />
            <Skeleton className="h-12 w-48 rounded-full" />
            <Skeleton className="h-12 w-48 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-64 w-full rounded-3xl" />
      </section>
      <div className="grid gap-4 md:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    </div>
  );
}
