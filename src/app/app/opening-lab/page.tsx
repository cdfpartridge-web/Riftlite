import { OpeningLab } from "@/components/opening-lab/OpeningLab";
import { createPageMetadata } from "@/lib/seo";

export const metadata = {
  ...createPageMetadata({
    title: "Opening Turns Lab",
    description:
      "Practise the first five turns of real RiftLite games on an interactive replay board.",
    path: "/app/opening-lab",
  }),
  robots: { index: false, follow: false },
};
export default function OpeningTurnsPage() {
  return <OpeningLab />;
}
