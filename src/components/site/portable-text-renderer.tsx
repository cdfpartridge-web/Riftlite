import { PortableText, type PortableTextComponents } from "@portabletext/react";

const components: PortableTextComponents = {
  block: {
    h2: ({ children }) => (
      <h2 className="mt-8 mb-3 text-2xl font-bold text-white first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-6 mb-2 text-lg font-semibold text-white">{children}</h3>
    ),
    normal: ({ children }) => (
      <p className="mb-4 leading-7 text-slate-300 last:mb-0">{children}</p>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-4 border-l-2 border-cyan-500/50 pl-4 italic text-slate-400">
        {children}
      </blockquote>
    ),
  },
  list: {
    bullet: ({ children }) => (
      <ul className="mb-4 list-disc space-y-1.5 pl-6 text-slate-300">{children}</ul>
    ),
    number: ({ children }) => (
      <ol className="mb-4 list-decimal space-y-1.5 pl-6 text-slate-300">{children}</ol>
    ),
  },
  listItem: {
    bullet: ({ children }) => <li className="leading-7">{children}</li>,
    number: ({ children }) => <li className="leading-7">{children}</li>,
  },
  marks: {
    strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
    em: ({ children }) => <em className="italic text-slate-200">{children}</em>,
    code: ({ children }) => (
      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-sm text-cyan-300">
        {children}
      </code>
    ),
  },
};

type PortableTextRendererProps = {
  value: unknown[];
};

export function PortableTextRenderer({ value }: PortableTextRendererProps) {
  return <PortableText value={value as never} components={components} />;
}
