"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type ComponentProps } from "react";
import { withDateFilterQuery } from "@/lib/date-filter-links";

type Props = ComponentProps<typeof Link>;

function ScopedLink(props: Props) {
  const search = useSearchParams();
  const href = typeof props.href === "string" ? withDateFilterQuery(props.href, new URLSearchParams(search?.toString())) : props.href;
  return <Link {...props} href={href} />;
}

/** The fallback keeps static pages renderable while the current query hydrates. */
export function DateFilterLink(props: Props) {
  return <Suspense fallback={<Link {...props} />}><ScopedLink {...props} /></Suspense>;
}
