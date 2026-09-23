import type { CanonicalReplayV2 } from "@/lib/replay-v2";

export type OpeningFilters = { legend: string; opponent?: string };
export type OpeningCatalog = {
  legends: string[];
  opponents: string[];
  scanned: number;
  limited: boolean;
};
export type OpeningQuestion = {
  token: string;
  turn: number;
  totalTurns: 5;
  legend: string;
  opponent: string;
  initiative: "first" | "second";
  replay: CanonicalReplayV2;
};
export type OpeningReveal = {
  replay: CanonicalReplayV2;
  next: OpeningQuestion | null;
  changes: string[];
};
