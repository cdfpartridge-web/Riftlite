import type { MatchupCaptureBreakdown, MatchupCell } from "@/lib/types";

export type DirectionalCapturePresentation = MatchupCaptureBreakdown & {
  pilotLegend: string;
  opponentLegend: string;
};

export type MatrixCellPresentation = {
  pooled: MatchupCell;
  direct: DirectionalCapturePresentation;
  reverse: DirectionalCapturePresentation;
};

export function matrixCellKey(myLegend: string, oppLegend: string): string {
  return `${myLegend}:::${oppLegend}`;
}

/**
 * Adapts the symmetric aggregate contract into labels the matrix can disclose.
 * `reverseCaptures` deliberately remains in the column pilot's native
 * perspective; only the top-level cell is expressed from the row perspective.
 */
export function buildMatrixCellPresentations(
  cells: MatchupCell[],
): Map<string, MatrixCellPresentation> {
  return new Map(
    cells.map((cell) => [
      matrixCellKey(cell.myLegend, cell.oppLegend),
      {
        pooled: cell,
        direct: {
          pilotLegend: cell.myLegend,
          opponentLegend: cell.oppLegend,
          ...cell.directCaptures,
        },
        reverse: {
          pilotLegend: cell.oppLegend,
          opponentLegend: cell.myLegend,
          ...cell.reverseCaptures,
        },
      },
    ]),
  );
}

function directionalSummary(direction: DirectionalCapturePresentation): string {
  if (direction.totalGames === 0) {
    return `${direction.pilotLegend} pilots: 0 captures`;
  }

  const rate = direction.decisiveGames
    ? `${direction.winRate.toFixed(1)}%`
    : "no decisive result";
  return `${direction.pilotLegend} pilots: ${direction.wins}W, ${direction.losses}L, ${direction.draws}D from ${direction.totalGames} captures (${rate})`;
}

export function matrixCellTooltip(presentation: MatrixCellPresentation): string {
  const { pooled, direct, reverse } = presentation;
  if (pooled.totalGames === 0) {
    return `${pooled.myLegend} vs ${pooled.oppLegend}: no capture records`;
  }

  const pooledRate = pooled.decisiveGames
    ? `${pooled.winRate.toFixed(1)}%`
    : "no decisive result";
  const directions =
    pooled.myLegend === pooled.oppLegend
      ? directionalSummary(direct)
      : `${directionalSummary(direct)}; ${directionalSummary(reverse)}`;

  return `Pooled for ${pooled.myLegend}: ${pooledRate} vs ${pooled.oppLegend} from ${pooled.totalGames} captures. Native pilot records: ${directions}.`;
}
