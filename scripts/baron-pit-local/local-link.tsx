import type { AnchorHTMLAttributes } from 'react';
export default function LocalLink({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={href} />;
}
