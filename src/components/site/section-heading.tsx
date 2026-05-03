import { Badge } from "@/components/ui/badge";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  headingLevel?: 1 | 2;
  id?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  headingLevel = 2,
  id,
}: SectionHeadingProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <div className="space-y-4">
      <Badge>{eyebrow}</Badge>
      <div className="space-y-3">
        <Heading className="font-display text-3xl font-bold tracking-tight text-white md:text-4xl" id={id}>
          {title}
        </Heading>
        {description ? (
          <p className="max-w-2xl text-base leading-7 text-slate-400">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
