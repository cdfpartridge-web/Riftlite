import { Badge } from "@/components/ui/badge";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  id?: string;
};

export function SectionHeading({ eyebrow, title, description, id }: SectionHeadingProps) {
  return (
    <div className="space-y-4">
      <Badge>{eyebrow}</Badge>
      <div className="space-y-3">
        <h2 className="font-display text-3xl font-bold tracking-tight text-white md:text-4xl" id={id}>
          {title}
        </h2>
        {description ? (
          <p className="max-w-2xl text-base leading-7 text-slate-400">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
