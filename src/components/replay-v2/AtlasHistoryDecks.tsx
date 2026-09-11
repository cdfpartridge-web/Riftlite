import { useState } from "react";
import {
  ATLAS_DECK_SECTIONS,
  atlasSideboardChanges,
  type AtlasMatchHistory,
} from "@/lib/replay-v2/atlas-history";
import "./atlas-history.css";

const labels = {
  legend: "Legend",
  champion: "Champion",
  mainDeck: "Main deck",
  sideboard: "Sideboard",
  battlefields: "Battlefields",
  runes: "Runes",
};

export function AtlasHistoryDecks({
  history,
  initialGame = 1,
}: {
  history: AtlasMatchHistory;
  initialGame?: number;
}) {
  const [gameNumber, setGameNumber] = useState(initialGame);
  const [side, setSide] = useState<"me" | "opponent">("opponent");
  const game = history.games.find((g) => g.gameNumber === gameNumber) || history.games[0];
  const deck = game?.[side];
  const [copiedDeck, setCopiedDeck] = useState<typeof deck>();
  const previous = history.games.find((g) => g.gameNumber === game?.gameNumber - 1);
  const changes = atlasSideboardChanges(previous?.[side], deck);
  if (!game || !deck) return null;
  return (
    <div className="atlas-history-decks">
      <div className="atlas-history-toolbar">
        <div className="atlas-history-segments" role="group" aria-label="Deck game">
          {history.games.map((g) => (
            <button
              type="button"
              key={g.gameNumber}
              aria-pressed={g === game}
              onClick={() => setGameNumber(g.gameNumber)}
            >
              Game {g.gameNumber}
              <small>
                {g.myPoints}–{g.opponentPoints}
              </small>
            </button>
          ))}
        </div>
        <div className="atlas-history-segments" role="group" aria-label="Deck player">
          <button type="button" aria-pressed={side === "me"} onClick={() => setSide("me")}>
            Your deck
          </button>
          <button type="button" aria-pressed={side === "opponent"} onClick={() => setSide("opponent")}>
            Opponent deck
          </button>
        </div>
      </div>
      <div className="atlas-history-title">
        <div>
          <small>ATLAS · GAME {game.gameNumber}</small>
          <h4>{side === "me" ? game.myName : game.opponentName}</h4>
        </div>
        {deck.availability === "available" ? (
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(
                  ATLAS_DECK_SECTIONS.map(
                    (section) =>
                      `${labels[section]}:\n${deck.cards
                        .filter((c) => c.section === section)
                        .map((c) => `${c.quantity} ${c.name}`)
                        .join("\n")}`,
                  ).join("\n\n"),
                )
                .then(() => setCopiedDeck(deck))
                .catch(() => setCopiedDeck(undefined))
            }
          >
            {copiedDeck === deck ? "Copied" : "Copy deck list"}
          </button>
        ) : null}
      </div>
      {deck.availability !== "available" ? (
        <p className="atlas-history-empty">
          {deck.availability === "private"
            ? "This player kept their deck private on Atlas."
            : "Atlas has not provided this game's deck list. You can refresh it later."}
        </p>
      ) : (
        <>
          {game.gameNumber > 1 ? (
            <section className="atlas-history-changes" aria-label="Sideboard changes">
              <h5>Changes from Game {game.gameNumber - 1}</h5>
              {changes === null ? (
                <p>The previous game&apos;s list is unavailable for comparison.</p>
              ) : changes.length ? (
                <div>
                  {changes.map((c) => (
                    <span className={c.delta > 0 ? "atlas-added" : "atlas-removed"} key={c.name}>
                      {c.delta > 0 ? "+" : "−"}
                      {Math.abs(c.delta)} {c.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p>No main-deck changes.</p>
              )}
            </section>
          ) : null}
          <div className="atlas-history-sections">
            {ATLAS_DECK_SECTIONS.map((section) => {
              const cards = deck.cards.filter((c) => c.section === section);
              if (!cards.length) return null;
              return (
                <details
                  className={`atlas-history-section atlas-history-${section}`}
                  key={`${game.gameNumber}-${side}-${section}`}
                  open={
                    section === "mainDeck" ||
                    section === "sideboard" ||
                    section === "legend" ||
                    section === "champion"
                  }
                >
                  <summary>
                    {labels[section]}
                    <span>{cards.reduce((n, c) => n + c.quantity, 0)}</span>
                  </summary>
                  <ul>
                    {cards.map((c) => (
                      <li key={c.name}>
                        <b>{c.quantity}×</b>
                        <span>{c.name}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
