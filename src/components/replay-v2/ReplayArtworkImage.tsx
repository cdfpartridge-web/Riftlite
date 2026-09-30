"use client";

import { type ComponentProps, useState } from "react";

/** Older battlefield scans are portrait; preview artwork can already be landscape. */
export function ReplayArtworkImage({
  battlefield,
  onLoad,
  src,
  ...props
}: Omit<ComponentProps<"img">, "src"> & { battlefield?: boolean; src: string }) {
  const [landscapeSource, setLandscapeSource] = useState<string>();
  return (
    // Replay captures use several external card image hosts.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={props.alt ?? ""}
      data-battlefield-landscape={battlefield && landscapeSource === src ? "true" : undefined}
      key={src}
      onLoad={(event) => {
        const image = event.currentTarget;
        setLandscapeSource(image.naturalWidth > image.naturalHeight ? src : undefined);
        onLoad?.(event);
      }}
      src={src}
    />
  );
}
