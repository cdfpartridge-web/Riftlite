"use client";

import {
  Clapperboard,
  ChevronDown,
  ChevronUp,
  Eye,
  Grid3X3,
  Lock,
  LockKeyhole,
  Maximize2,
  MonitorPlay,
  MousePointer2,
  RefreshCw,
  ShieldCheck,
  Table2,
  Video,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "@/components/meta-studio/MetaStudio.module.css";
import type {
  MetaStudioFilters,
  MetaStudioLeader,
  MetaStudioMatchup,
  MetaStudioReport,
} from "@/lib/community/meta-studio";
import { getLegendCardImageUrl, getLegendInitials } from "@/lib/legends";

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

type MetaStudioCanvasProps = {
  report: MetaStudioReport;
  filters: MetaStudioFilters;
  loading: boolean;
  error: string;
  preview: boolean;
  onFiltersChange: (filters: MetaStudioFilters) => void;
  onOpenCreatorVideos: () => void;
  onLock: () => void;
  onRefresh: () => void;
};

type Scene = "overview" | "matrix";
type MatrixSelection = { legend: string; opponent: string };

function percent(value: number) {
  return `${value.toFixed(1)}%`;
}

function integer(value: number) {
  return value.toLocaleString("en-GB");
}

function dateLabel(value: number) {
  if (!value) return "No dated records";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function timeLabel(value: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function legendShortName(legend: string) {
  if (legend === "Master Yi, Wuju Master") return "Yi Master";
  if (legend === "Master Yi, Wuju Bladesman") return "Yi Bladesman";
  return legend.split(",")[0]?.trim() || legend;
}

function legendArt(leader: MetaStudioLeader | undefined) {
  if (!leader) return "";
  return leader.cardArtUrl || getLegendCardImageUrl(leader.legend);
}

function classificationLabel(matchup: MetaStudioMatchup) {
  if (matchup.classification === "favorable") return "Favoured";
  if (matchup.classification === "unfavorable") return "Unfavoured";
  if (matchup.classification === "even") return "Even";
  return "Small sample";
}

function confidenceLabel(matchup: MetaStudioMatchup) {
  if (matchup.confidence === "high") return "High confidence";
  if (matchup.confidence === "medium") return "Medium confidence";
  if (matchup.confidence === "low") return "Early signal";
  return "Below threshold";
}

function matchupTone(matchup: MetaStudioMatchup | undefined) {
  if (!matchup || matchup.classification === "insufficient") return styles.toneInsufficient;
  if (matchup.classification === "favorable") return styles.toneFavorable;
  if (matchup.classification === "unfavorable") return styles.toneUnfavorable;
  return styles.toneEven;
}

function matchupWinRate(matchup: MetaStudioMatchup | undefined) {
  return matchup?.decisiveSeries ? percent(matchup.winRate) : "—";
}

function useCanvasScale() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ scale: 1, left: 0, top: 0 });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      const scale = Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT);
      setLayout({
        scale,
        left: Math.max(0, (width - CANVAS_WIDTH * scale) / 2),
        top: Math.max(0, (height - CANVAS_HEIGHT * scale) / 2),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return { hostRef, layout };
}

function LegendImage({
  leader,
  className,
}: {
  leader: MetaStudioLeader;
  className: string;
}) {
  const [failedUrl, setFailedUrl] = useState("");
  const src = legendArt(leader);
  const failed = failedUrl === src;

  return (
    <div className={`${styles.legendImageFrame} ${className}`}>
      <div className={styles.legendFallback}>{getLegendInitials(leader.legend)}</div>
      {failed ? null : (
        // The current community cache can contain trusted card CDN URLs that
        // are not all represented in Next's static hostname allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${leader.legend} legend card`}
          onError={() => setFailedUrl(src)}
          src={src}
        />
      )}
    </div>
  );
}

function RankMovement({
  leader,
  comparisonAvailable,
}: {
  leader: MetaStudioLeader;
  comparisonAvailable: boolean;
}) {
  if (!comparisonAvailable) {
    return <span className={styles.rankFlat} title="No complete comparable prior period">—</span>;
  }
  if (leader.previousRank === null) {
    return <span className={styles.rankNew}>NEW</span>;
  }
  if (!leader.rankDelta) {
    return <span className={styles.rankFlat}>—</span>;
  }
  if (leader.rankDelta > 0) {
    return (
      <span className={styles.rankUp}>
        <ChevronUp aria-hidden="true" size={16} />
        {leader.rankDelta}
      </span>
    );
  }
  return (
    <span className={styles.rankDown}>
      <ChevronDown aria-hidden="true" size={16} />
      {Math.abs(leader.rankDelta)}
    </span>
  );
}

function SplitTile({
  label,
  split,
}: {
  label: string;
  split: MetaStudioLeader["first"];
}) {
  return (
    <div className={styles.splitTile}>
      <span>{label}</span>
      <strong>{split.decisiveSeries ? percent(split.winRate) : "—"}</strong>
      <small>{integer(split.series)} series</small>
    </div>
  );
}

function MatchupRow({
  matchup,
  opponent,
  active,
  onPreview,
  onLeave,
  onPin,
}: {
  matchup: MetaStudioMatchup;
  opponent?: MetaStudioLeader;
  active: boolean;
  onPreview: () => void;
  onLeave: () => void;
  onPin: () => void;
}) {
  return (
    <button
      className={`${styles.matchupRow} ${matchupTone(matchup)} ${active ? styles.matchupRowActive : ""}`}
      onBlur={onLeave}
      onClick={onPin}
      onFocus={onPreview}
      onMouseEnter={onPreview}
      onMouseLeave={onLeave}
      type="button"
    >
      <span className={styles.matchupPortrait}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={opponent ? legendArt(opponent) : getLegendCardImageUrl(matchup.opponentLegend)} />
      </span>
      <span className={styles.matchupIdentity}>
        <strong>{legendShortName(matchup.opponentLegend)}</strong>
        <small>{confidenceLabel(matchup)}</small>
      </span>
      <span className={styles.matchupScore}>
        <strong>{matchupWinRate(matchup)}</strong>
        <small>n={integer(matchup.decisiveSeries)} decisive</small>
      </span>
    </button>
  );
}

function MatchupDetail({
  leader,
  matchup,
  leaders,
}: {
  leader: MetaStudioLeader;
  matchup: MetaStudioMatchup | undefined;
  leaders: MetaStudioLeader[];
}) {
  if (!matchup) {
    return (
      <div className={styles.emptyMatchup}>
        <Eye aria-hidden="true" />
        <strong>No qualifying matchup yet</strong>
        <span>Reduce the sample threshold or choose another legend.</span>
      </div>
    );
  }
  const opponent = leaders.find((item) => item.legend === matchup.opponentLegend);

  return (
    <div className={`${styles.matchupDetail} ${matchupTone(matchup)}`}>
      <div className={styles.matchupVersus}>
        <span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src={legendArt(leader)} />
        </span>
        <b>VS</b>
        <span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src={opponent ? legendArt(opponent) : getLegendCardImageUrl(matchup.opponentLegend)} />
        </span>
      </div>
      <div className={styles.matchupDetailCopy}>
        <small>{classificationLabel(matchup)}</small>
        <h3>{legendShortName(matchup.opponentLegend)}</h3>
        <strong>{matchupWinRate(matchup)}</strong>
        <p>
          {integer(matchup.wins)}W · {integer(matchup.losses)}L
          {matchup.draws ? ` · ${integer(matchup.draws)}D` : ""}
        </p>
      </div>
      <div className={styles.matchupDetailSplits}>
        <div>
          <span>Going first</span>
          <strong>{matchup.first.decisiveSeries ? percent(matchup.first.winRate) : "—"}</strong>
          <small>n={matchup.first.series}</small>
        </div>
        <div>
          <span>Going second</span>
          <strong>{matchup.second.decisiveSeries ? percent(matchup.second.winRate) : "—"}</strong>
          <small>n={matchup.second.series}</small>
        </div>
      </div>
    </div>
  );
}

function OverviewScene({
  report,
  displayedLeader,
  pinnedLegend,
  displayedMatchup,
  hoveredMatchup,
  pinnedMatchup,
  onLegendPreview,
  onLegendLeave,
  onLegendPin,
  onMatchupPreview,
  onMatchupLeave,
  onMatchupPin,
}: {
  report: MetaStudioReport;
  displayedLeader: MetaStudioLeader;
  pinnedLegend: string;
  displayedMatchup: MetaStudioMatchup | undefined;
  hoveredMatchup: string;
  pinnedMatchup: string;
  onLegendPreview: (legend: string) => void;
  onLegendLeave: () => void;
  onLegendPin: (legend: string) => void;
  onMatchupPreview: (opponent: string) => void;
  onMatchupLeave: () => void;
  onMatchupPin: (opponent: string) => void;
}) {
  const topLeaders = report.leaders.slice(0, 10);
  const strong = [...displayedLeader.matchups]
    .filter((matchup) => matchup.classification === "favorable")
    .sort((left, right) => right.winRate - left.winRate || right.series - left.series)
    .slice(0, 3);
  const weak = [...displayedLeader.matchups]
    .filter((matchup) => matchup.classification === "unfavorable")
    .sort((left, right) => left.winRate - right.winRate || right.series - left.series)
    .slice(0, 3);
  const strip = [...displayedLeader.matchups]
    .sort((left, right) => right.series - left.series)
    .slice(0, 10);
  const opponentMap = new Map(report.leaders.map((leader) => [leader.legend, leader]));

  return (
    <>
      <div className={styles.overviewGrid}>
        <section className={`${styles.panel} ${styles.heroPanel}`}>
          <div className={styles.heroRank}>
            <span>RANK</span>
            <strong>#{displayedLeader.rank}</strong>
            <RankMovement
              comparisonAvailable={report.coverage.comparisonAvailable}
              leader={displayedLeader}
            />
          </div>
          <LegendImage className={styles.heroCard} leader={displayedLeader} />
          <div className={styles.heroIdentity}>
            <span>{displayedLeader.cardId || "RIFTBOUND LEGEND"}</span>
            <h2>{displayedLeader.legend}</h2>
          </div>
          <div className={styles.heroPrimaryStats}>
            <div>
              <span>Adjusted WR</span>
              <strong>{percent(displayedLeader.adjustedWinRate)}</strong>
            </div>
            <div>
              <span>Raw WR</span>
              <strong>{percent(displayedLeader.winRate)}</strong>
            </div>
            <div>
              <span>Play rate</span>
              <strong>{percent(displayedLeader.playRate)}</strong>
            </div>
            <div>
              <span>Series</span>
              <strong>{integer(displayedLeader.series)}</strong>
            </div>
          </div>
          <div className={styles.heroSplits}>
            <SplitTile label="Going first" split={displayedLeader.first} />
            <SplitTile label="Going second" split={displayedLeader.second} />
          </div>
        </section>

        <section className={`${styles.panel} ${styles.rankingPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <span>POWER RANKING</span>
              <h2>Top 10 legends</h2>
            </div>
            <div className={styles.hoverHint}>
              <MousePointer2 aria-hidden="true" size={18} />
              Hover to preview · click to lock
            </div>
          </div>
          <div className={styles.rankingHeader}>
            <span>#</span>
            <span>Legend</span>
            <span>Adj. WR</span>
            <span>Play</span>
            <span>Series</span>
            <span>Move</span>
          </div>
          <div className={styles.rankingRows}>
            {topLeaders.map((leader) => {
              const active = leader.legend === displayedLeader.legend;
              const pinned = leader.legend === pinnedLegend;
              return (
                <button
                  aria-pressed={pinned}
                  className={`${styles.rankingRow} ${active ? styles.rankingRowActive : ""}`}
                  key={leader.legend}
                  onBlur={onLegendLeave}
                  onClick={() => onLegendPin(leader.legend)}
                  onFocus={() => onLegendPreview(leader.legend)}
                  onMouseEnter={() => onLegendPreview(leader.legend)}
                  onMouseLeave={onLegendLeave}
                  type="button"
                >
                  <span className={styles.rankingNumber}>{leader.rank}</span>
                  <span className={styles.rankingLegend}>
                    <span className={styles.rankingPortrait}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" src={legendArt(leader)} />
                    </span>
                    <strong>{legendShortName(leader.legend)}</strong>
                    {pinned ? <Lock aria-label="Pinned" size={13} /> : null}
                  </span>
                  <strong className={styles.rankingWinRate}>{percent(leader.adjustedWinRate)}</strong>
                  <span>{percent(leader.playRate)}</span>
                  <span>{integer(leader.series)}</span>
                  <RankMovement
                    comparisonAvailable={report.coverage.comparisonAvailable}
                    leader={leader}
                  />
                </button>
              );
            })}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.matchupsPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <span>MATCHUP READ</span>
              <h2>Where {legendShortName(displayedLeader.legend)} wins</h2>
            </div>
            <div className={styles.matchupCounts}>
              <b className={styles.goodCount}>{displayedLeader.favorableMatchups}</b>
              <span>/</span>
              <b>{displayedLeader.evenMatchups}</b>
              <span>/</span>
              <b className={styles.badCount}>{displayedLeader.unfavorableMatchups}</b>
            </div>
          </div>

          <div className={styles.matchupColumns}>
            <div>
              <div className={styles.matchupColumnTitle}>
                <span className={styles.goodDot} />
                Good into
              </div>
              <div className={styles.matchupList}>
                {strong.length ? strong.map((matchup) => (
                  <MatchupRow
                    active={(hoveredMatchup || pinnedMatchup) === matchup.opponentLegend}
                    key={matchup.opponentLegend}
                    matchup={matchup}
                    onLeave={onMatchupLeave}
                    onPin={() => onMatchupPin(matchup.opponentLegend)}
                    onPreview={() => onMatchupPreview(matchup.opponentLegend)}
                    opponent={opponentMap.get(matchup.opponentLegend)}
                  />
                )) : <div className={styles.emptyList}>No favoured matchup has cleared the sample threshold.</div>}
              </div>
            </div>
            <div>
              <div className={styles.matchupColumnTitle}>
                <span className={styles.badDot} />
                Struggles into
              </div>
              <div className={styles.matchupList}>
                {weak.length ? weak.map((matchup) => (
                  <MatchupRow
                    active={(hoveredMatchup || pinnedMatchup) === matchup.opponentLegend}
                    key={matchup.opponentLegend}
                    matchup={matchup}
                    onLeave={onMatchupLeave}
                    onPin={() => onMatchupPin(matchup.opponentLegend)}
                    onPreview={() => onMatchupPreview(matchup.opponentLegend)}
                    opponent={opponentMap.get(matchup.opponentLegend)}
                  />
                )) : <div className={styles.emptyList}>No unfavoured matchup has cleared the sample threshold.</div>}
              </div>
            </div>
          </div>

          <MatchupDetail
            leader={displayedLeader}
            leaders={report.leaders}
            matchup={displayedMatchup}
          />
        </section>
      </div>

      <section className={`${styles.panel} ${styles.matchupStrip}`}>
        <div className={styles.stripHeading}>
          <div>
            <span>META AT A GLANCE</span>
            <strong>{legendShortName(displayedLeader.legend)} matchup row</strong>
          </div>
          <p>
            Overall series win rate · first/second split appears in the selected matchup
          </p>
        </div>
        <div className={styles.stripItems}>
          {strip.map((matchup) => (
            <button
              className={`${styles.stripItem} ${matchupTone(matchup)} ${
                displayedMatchup?.opponentLegend === matchup.opponentLegend ? styles.stripItemActive : ""
              }`}
              key={matchup.opponentLegend}
              onBlur={onMatchupLeave}
              onClick={() => onMatchupPin(matchup.opponentLegend)}
              onFocus={() => onMatchupPreview(matchup.opponentLegend)}
              onMouseEnter={() => onMatchupPreview(matchup.opponentLegend)}
              onMouseLeave={onMatchupLeave}
              type="button"
            >
              <span className={styles.stripPortrait}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src={opponentMap.get(matchup.opponentLegend) ? legendArt(opponentMap.get(matchup.opponentLegend)) : getLegendCardImageUrl(matchup.opponentLegend)} />
              </span>
              <span>
                <strong>{matchupWinRate(matchup)}</strong>
                <small>{legendShortName(matchup.opponentLegend)}</small>
              </span>
              <em>n={matchup.decisiveSeries}</em>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

export function MatrixScene({
  report,
  selection,
  onPreview,
  onLeave,
  onPin,
}: {
  report: MetaStudioReport;
  selection: MatrixSelection | null;
  onPreview: (selection: MatrixSelection) => void;
  onLeave: () => void;
  onPin: (selection: MatrixSelection) => void;
}) {
  const leaders = report.leaders.slice(0, 12);
  const leaderMap = new Map(leaders.map((leader) => [leader.legend, leader]));
  const selectedLeader = leaderMap.get(selection?.legend ?? "") ?? leaders[0];
  const requestedMatchup = selectedLeader?.matchups.find(
    (matchup) =>
      matchup.opponentLegend !== selectedLeader.legend &&
      matchup.opponentLegend === selection?.opponent &&
      leaderMap.has(matchup.opponentLegend),
  );
  const selectedMatchup = requestedMatchup ?? selectedLeader?.matchups.find(
    (matchup) =>
      matchup.opponentLegend !== selectedLeader.legend &&
      leaderMap.has(matchup.opponentLegend),
  );
  const selectedOpponent = requestedMatchup?.opponentLegend
    ?? selectedMatchup?.opponentLegend
    ?? leaders.find((leader) => leader.legend !== selectedLeader?.legend)?.legend
    ?? "";
  const effectiveSelection = selectedLeader && selectedOpponent
    ? { legend: selectedLeader.legend, opponent: selectedOpponent }
    : null;

  return (
    <div className={styles.matrixLayout}>
      <section className={`${styles.panel} ${styles.matrixPanel}`}>
        <div className={styles.panelHeading}>
          <div>
            <span>TOP-12 FIELD</span>
            <h2>Interactive matchup matrix</h2>
          </div>
          <div className={styles.hoverHint}>
            <MousePointer2 aria-hidden="true" size={18} />
            Hover any cell to inspect
          </div>
        </div>
        <div
          className={styles.matrixGrid}
          style={{ gridTemplateColumns: `180px repeat(${leaders.length}, minmax(0, 1fr))` }}
        >
          <div className={styles.matrixCorner}>YOUR LEGEND</div>
          {leaders.map((leader) => (
            <div className={styles.matrixColumnHead} key={`head-${leader.legend}`}>
              <span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src={legendArt(leader)} />
              </span>
              <small>{legendShortName(leader.legend)}</small>
            </div>
          ))}
          {leaders.flatMap((leader) => {
            const row = [
              <div className={styles.matrixRowHead} key={`row-${leader.legend}`}>
                <span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" src={legendArt(leader)} />
                </span>
                <div className={styles.matrixRowCopy}>
                  <strong>{legendShortName(leader.legend)}</strong>
                  <small>{percent(leader.winRate)} overall</small>
                </div>
              </div>,
            ];
            for (const opponent of leaders) {
              if (leader.legend === opponent.legend) {
                row.push(
                  <div
                    aria-label={`${leader.legend} mirror matchup hidden`}
                    className={`${styles.matrixCell} ${styles.matrixCellMirror}`}
                    data-matrix-mirror
                    key={`${leader.legend}-${opponent.legend}`}
                  />,
                );
                continue;
              }
              const matchup = leader.matchups.find((item) => item.opponentLegend === opponent.legend);
              const active =
                effectiveSelection?.legend === leader.legend &&
                effectiveSelection.opponent === opponent.legend;
              row.push(
                <button
                  aria-label={`${leader.legend} into ${opponent.legend}: ${
                    matchup?.series
                      ? `${matchupWinRate(matchup)}, ${matchup.decisiveSeries} decisive series, ${classificationLabel(matchup)}`
                      : "no data"
                  }`}
                  className={`${styles.matrixCell} ${matchupTone(matchup)} ${active ? styles.matrixCellActive : ""}`}
                  key={`${leader.legend}-${opponent.legend}`}
                  onBlur={onLeave}
                  onClick={() => onPin({ legend: leader.legend, opponent: opponent.legend })}
                  onFocus={() => onPreview({ legend: leader.legend, opponent: opponent.legend })}
                  onMouseEnter={() => onPreview({ legend: leader.legend, opponent: opponent.legend })}
                  onMouseLeave={onLeave}
                  type="button"
                >
                  <strong>{matchupWinRate(matchup)}</strong>
                  <small>{matchup?.series ? `n=${matchup.decisiveSeries}` : "no data"}</small>
                </button>,
              );
            }
            return row;
          })}
        </div>
      </section>

      <aside className={`${styles.panel} ${styles.matrixInspector}`}>
        {selectedLeader ? (
          <>
            <div className={styles.inspectorEyebrow}>HOVERED MATCHUP</div>
            <div className={styles.inspectorHero}>
              <LegendImage className={styles.inspectorCard} leader={selectedLeader} />
              <div>
                <span>#{selectedLeader.rank} in the field</span>
                <h2>{legendShortName(selectedLeader.legend)}</h2>
                <strong>{percent(selectedLeader.adjustedWinRate)}</strong>
                <small>adjusted win rate</small>
              </div>
            </div>
            <MatchupDetail
              leader={selectedLeader}
              leaders={report.leaders}
              matchup={selectedMatchup}
            />
            <div className={styles.matrixLegend}>
              <div><span className={styles.goodDot} /> 55%+ favoured</div>
              <div><span className={styles.evenDot} /> &gt;45% and &lt;55% even</div>
              <div><span className={styles.badDot} /> 45% or less unfavoured</div>
              <div><span className={styles.mutedDot} /> Below decisive sample</div>
              <div><span className={styles.mutedDot} /> Mirrors hidden</div>
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}

export function MetaStudioCanvas({
  report,
  filters,
  loading,
  error,
  preview,
  onFiltersChange,
  onOpenCreatorVideos,
  onLock,
  onRefresh,
}: MetaStudioCanvasProps) {
  const { hostRef, layout } = useCanvasScale();
  const [scene, setScene] = useState<Scene>("overview");
  const [clean, setClean] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pinnedLegend, setPinnedLegend] = useState(report.leaders[0]?.legend ?? "");
  const [hoveredLegend, setHoveredLegend] = useState("");
  const [pinnedMatchup, setPinnedMatchup] = useState("");
  const [hoveredMatchup, setHoveredMatchup] = useState("");
  const [pinnedMatrix, setPinnedMatrix] = useState<MatrixSelection | null>(null);
  const [hoveredMatrix, setHoveredMatrix] = useState<MatrixSelection | null>(null);

  const effectivePinnedLegend = report.leaders.some(
    (leader) => leader.legend === pinnedLegend,
  )
    ? pinnedLegend
    : report.leaders[0]?.legend ?? "";

  const displayedLeader = useMemo(
    () => report.leaders.find((leader) => leader.legend === hoveredLegend)
      ?? report.leaders.find((leader) => leader.legend === effectivePinnedLegend)
      ?? report.leaders[0],
    [effectivePinnedLegend, hoveredLegend, report.leaders],
  );

  const defaultMatchup =
    displayedLeader?.matchups.find((item) => item.classification === "favorable")
    ?? displayedLeader?.matchups.find((item) => item.classification === "unfavorable")
    ?? displayedLeader?.matchups[0];
  const effectivePinnedMatchup = displayedLeader?.matchups.some(
    (item) => item.opponentLegend === pinnedMatchup,
  )
    ? pinnedMatchup
    : defaultMatchup?.opponentLegend ?? "";
  const effectiveHoveredMatchup = displayedLeader?.matchups.some(
    (item) => item.opponentLegend === hoveredMatchup,
  )
    ? hoveredMatchup
    : "";

  const displayedMatchup = displayedLeader?.matchups.find(
    (matchup) => matchup.opponentLegend === (
      effectiveHoveredMatchup || effectivePinnedMatchup
    ),
  );
  const matrixSelection = hoveredMatrix || pinnedMatrix;

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        setClean((value) => !value);
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        const operation = document.fullscreenElement
          ? document.exitFullscreen?.()
          : document.documentElement.requestFullscreen?.();
        void operation?.catch(() => undefined);
        return;
      }
      if (target?.closest("a, button, input, select, textarea, [contenteditable='true']")) return;
      const visibleLeaders = report.leaders.slice(0, 10);
      if (
        scene !== "overview" ||
        !["ArrowUp", "ArrowDown", "Home"].includes(event.key) ||
        !visibleLeaders.length
      ) return;
      event.preventDefault();
      const currentIndex = Math.max(
        0,
        visibleLeaders.findIndex((leader) => leader.legend === effectivePinnedLegend),
      );
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "ArrowUp"
          ? Math.max(0, currentIndex - 1)
          : Math.min(visibleLeaders.length - 1, currentIndex + 1);
      setPinnedLegend(visibleLeaders[nextIndex]?.legend ?? effectivePinnedLegend);
      setHoveredLegend("");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [effectivePinnedLegend, report.leaders, scene]);

  function toggleFullscreen() {
    const operation = document.fullscreenElement
      ? document.exitFullscreen?.()
      : document.documentElement.requestFullscreen?.();
    void operation?.catch(() => undefined);
  }

  function updateFilter<K extends keyof MetaStudioFilters>(
    key: K,
    value: MetaStudioFilters[K],
  ) {
    onFiltersChange({ ...filters, [key]: value });
  }

  if (!displayedLeader) {
    return (
      <div className={styles.statePage}>
        <div className={styles.stateCard}>
          <span>RIFTLITE COMMUNITY META</span>
          <h1>No qualifying legend results</h1>
          <p>Try a wider reporting window or remove a platform or format filter.</p>
          <button
            onClick={() => onFiltersChange({
              range: "30d",
              season: "",
              format: "all",
              platform: "all",
              minSample: 5,
            })}
            type="button"
          >
            Reset to a broad report
          </button>
        </div>
      </div>
    );
  }

  const sourceTotal = report.coverage.sourcePeriodRecordsExact
    ? integer(report.coverage.sourcePeriodRecords)
    : `at least ${integer(report.coverage.sourcePeriodRecords)}`;
  const sourceLabel = report.coverage.detailedRecords === report.coverage.loadedPeriodRecords
    ? `${integer(report.coverage.detailedRecords)} filtered series`
    : `${integer(report.coverage.detailedRecords)} filtered of ${integer(report.coverage.loadedPeriodRecords)} loaded`;

  return (
    <div className={styles.viewport} data-clean={clean ? "true" : "false"} ref={hostRef}>
      <div
        className={styles.canvas}
        data-testid="meta-studio-canvas"
        style={{
          left: layout.left,
          top: layout.top,
          transform: `scale(${layout.scale})`,
        }}
      >
        <div className={styles.canvasBackdrop}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src={legendArt(displayedLeader)} />
        </div>
        <div className={styles.noise} />

        <header className={styles.topBar}>
          <div className={styles.brandBlock}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="RiftLite" src="/brand/riftlite-logo-transparent.png" />
            <div>
              <span>PRIVATE META STUDIO</span>
              <h1>RiftLite Community Meta</h1>
            </div>
          </div>

          <div className={styles.reportScope}>
            <ShieldCheck aria-hidden="true" size={20} />
            <div>
              <span>{dateLabel(report.window.start)} — {dateLabel(report.window.end)}</span>
              <small>
                {sourceLabel} · {sourceTotal} source rows · {integer(report.coverage.uniquePlayers)} contributors
              </small>
            </div>
          </div>

          {clean ? (
            <div aria-hidden="true" className={`${styles.controls} ${styles.controlsHidden}`} />
          ) : (
          <div className={styles.controls}>
            <label>
              <span>Window</span>
              <select
                disabled={preview}
                onChange={(event) => updateFilter("range", event.target.value as MetaStudioFilters["range"])}
                value={filters.range}
              >
                <option value="1d">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="14d">Last 14 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </label>
            <label>
              <span>Season</span>
              <select
                disabled={preview}
                onChange={(event) => updateFilter("season", event.target.value as MetaStudioFilters["season"])}
                value={filters.season}
              >
                <option value="">All seasons</option>
                <option value="vendetta-launch">Vendetta launch</option>
                <option value="vendetta-preview">Vendetta preview</option>
                <option value="pre-vendetta">Pre-Vendetta</option>
              </select>
            </label>
            <label>
              <span>Format</span>
              <select
                disabled={preview}
                onChange={(event) => updateFilter("format", event.target.value as MetaStudioFilters["format"])}
                value={filters.format}
              >
                <option value="all">All formats</option>
                <option value="bo1">Best of 1</option>
                <option value="bo3">Best of 3</option>
              </select>
            </label>
            <label>
              <span>Platform</span>
              <select
                disabled={preview || report.coverage.platformKnownRecords === 0}
                onChange={(event) => updateFilter("platform", event.target.value as MetaStudioFilters["platform"])}
                title={report.coverage.platformKnownRecords === 0 ? "Platform was not retained in the current community cache." : ""}
                value={filters.platform}
              >
                <option value="all">All platforms</option>
                <option value="atlas">RiftAtlas</option>
                <option value="tcga">TCGA</option>
              </select>
            </label>
            <label>
              <span>Min sample</span>
              <select
                disabled={preview}
                onChange={(event) => updateFilter("minSample", Number(event.target.value) as MetaStudioFilters["minSample"])}
                value={filters.minSample}
              >
                <option value={5}>5 decisive</option>
                <option value={10}>10 decisive</option>
                <option value={20}>20 decisive</option>
              </select>
            </label>
          </div>
          )}

          <div className={styles.actions}>
            <div className={styles.sceneSwitch}>
              <button
                aria-label="Overview scene"
                aria-pressed={scene === "overview"}
                className={scene === "overview" ? styles.sceneActive : ""}
                onClick={() => setScene("overview")}
                type="button"
              >
                <Table2 aria-hidden="true" size={18} />
              </button>
              <button
                aria-label="Matrix scene"
                aria-pressed={scene === "matrix"}
                className={scene === "matrix" ? styles.sceneActive : ""}
                onClick={() => setScene("matrix")}
                type="button"
              >
                <Grid3X3 aria-hidden="true" size={18} />
              </button>
            </div>
            <Link
              aria-label="Open Caster Studio"
              className={`${styles.iconButton} ${clean ? styles.chromeHidden : ""}`}
              href={preview ? "/meta-studio/caster?preview=1" : "/meta-studio/caster"}
              title="Open private Caster Studio"
            >
              <Clapperboard aria-hidden="true" size={19} />
            </Link>
            <button
              aria-label="Manage creator video carousel"
              className={`${styles.iconButton} ${styles.creatorManagerButton} ${clean ? styles.chromeHidden : ""}`}
              disabled={loading || preview}
              onClick={onOpenCreatorVideos}
              title={preview ? "Disabled in local fixture preview" : "Manage the desktop Home creator video carousel"}
              type="button"
            >
              <Video aria-hidden="true" size={19} />
              <span>Creator videos</span>
            </button>
            <button
              aria-label="Refresh report"
              className={styles.iconButton}
              disabled={loading || preview}
              onClick={onRefresh}
              title={preview ? "Disabled in local fixture preview" : "Refresh report"}
              type="button"
            >
              <RefreshCw aria-hidden="true" className={loading ? styles.spinning : ""} size={19} />
            </button>
            <button
              aria-label="Toggle clean presenter mode"
              aria-pressed={clean}
              className={`${styles.iconButton} ${clean ? styles.iconButtonActive : ""}`}
              onClick={() => setClean((value) => !value)}
              title="Presenter mode (P)"
              type="button"
            >
              <MonitorPlay aria-hidden="true" size={19} />
            </button>
            <button
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className={styles.iconButton}
              onClick={toggleFullscreen}
              title={`${fullscreen ? "Exit" : "Enter"} fullscreen (F)`}
              type="button"
            >
              <Maximize2 aria-hidden="true" size={19} />
            </button>
            <button
              aria-label="Lock Meta Studio"
              className={`${styles.iconButton} ${clean ? styles.chromeHidden : ""}`}
              disabled={loading || preview}
              onClick={onLock}
              title={preview ? "Disabled in local fixture preview" : "Lock this private session"}
              type="button"
            >
              <LockKeyhole aria-hidden="true" size={19} />
            </button>
          </div>
        </header>

        {report.coverage.detailWindowTruncated ? (
          <div className={styles.coverageWarning}>
            Long-range filters use {integer(report.coverage.loadedPeriodRecords)} loaded detail rows;
            this period contains {sourceTotal} source rows. Use 7 days for the most complete presenter view.
          </div>
        ) : filters.range !== "30d" && !report.coverage.comparisonWindowComplete ? (
          <div className={styles.coverageWarning}>
            The current period is complete. Rank movement is hidden because the prior period is not fully represented.
          </div>
        ) : null}

        <main className={styles.stage}>
          {scene === "overview" ? (
            <OverviewScene
              displayedLeader={displayedLeader}
              displayedMatchup={displayedMatchup}
              hoveredMatchup={effectiveHoveredMatchup}
              onLegendLeave={() => setHoveredLegend("")}
              onLegendPin={(legend) => {
                setPinnedLegend(legend);
                setHoveredLegend("");
              }}
              onLegendPreview={setHoveredLegend}
              onMatchupLeave={() => setHoveredMatchup("")}
              onMatchupPin={(opponent) => {
                setPinnedMatchup(opponent);
                setHoveredMatchup("");
              }}
              onMatchupPreview={setHoveredMatchup}
              pinnedLegend={effectivePinnedLegend}
              pinnedMatchup={effectivePinnedMatchup}
              report={report}
            />
          ) : (
            <MatrixScene
              onLeave={() => setHoveredMatrix(null)}
              onPin={(selection) => {
                setPinnedMatrix(selection);
                setHoveredMatrix(null);
              }}
              onPreview={setHoveredMatrix}
              report={report}
              selection={matrixSelection}
            />
          )}
        </main>

        <footer className={styles.footerBar}>
          <div>
            <span className={styles.livePip} />
            Community submissions · one player perspective per series
          </div>
          <div>
            Adjusted WR uses a transparent 20-series, 50% prior · matchup colours require n≥{filters.minSample} decisive
          </div>
          <div>
            Source refreshed {timeLabel(report.coverage.sourceAsOf)}
            {preview ? " · LOCAL FIXTURE PREVIEW" : ""}
          </div>
        </footer>

        {loading ? <div aria-live="polite" className={styles.loadingVeil} role="status"><RefreshCw className={styles.spinning} /> Updating report</div> : null}
        {error ? <div className={styles.errorToast} role="alert">{error}</div> : null}
        {clean ? <div className={styles.cleanHint}>P — exit presenter mode</div> : null}
      </div>
    </div>
  );
}
