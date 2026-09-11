"use client";
import { useEffect, useRef, useState } from "react";
import { getAuth } from "firebase/auth";
import { firebaseClientApp } from "@/lib/firebase/client";
import { normalizeAtlasMatchHistory, type AtlasMatchHistory } from "@/lib/replay-v2/atlas-history";
import { AtlasHistoryDecks } from "./AtlasHistoryDecks";
import "./replay-history-decks.css";

type ReplayHistoryDeckPanelProps = {
  replayId: string;
  apiBasePath: string;
  gameNumber: number;
  onOpen: () => void;
};

export function ReplayHistoryDeckPanel(props: ReplayHistoryDeckPanelProps) {
  return <MatchDeckDialog key={`${props.apiBasePath}/${props.replayId}`} {...props} />;
}

function MatchDeckDialog({
  replayId,
  apiBasePath,
  gameNumber,
  onOpen,
}: ReplayHistoryDeckPanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<AtlasMatchHistory>();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const controller = new AbortController();
    void (async () => {
      const headers: Record<string, string> = { Accept: "application/json" };
      try {
        const auth = getAuth(firebaseClientApp);
        await auth.authStateReady();
        if (auth.currentUser && !auth.currentUser.isAnonymous)
          headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
      } catch {
        /* Desktop embed uses its existing HttpOnly cookie. */
      }
      if (controller.signal.aborted) return;
      const response = await fetch(`${apiBasePath}/${encodeURIComponent(replayId)}/decks`, {
        headers,
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if ([401, 403, 404].includes(response.status)) {
        setMessage(
          "Match decks are available to the replay owner after adding them from RiftLite match history.",
        );
        return;
      }
      if (!response.ok) throw new Error("Decks could not be loaded. Close this panel and try again.");
      const data = normalizeAtlasMatchHistory((await response.json()).history);
      if (controller.signal.aborted) return;
      setHistory(data);
      if (!data?.games.length)
        setMessage(
          "No match decks have been added yet. In the desktop app, open this match, get its Atlas decks, then choose Add to Web Replay.",
        );
    })()
      .catch((error) => {
        if (!controller.signal.aborted)
          setMessage(error instanceof Error ? error.message : "Decks could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, replayId, apiBasePath]);
  return (
    <>
      <button
        type="button"
        className="replay-history-decks-button"
        aria-haspopup="dialog"
        onClick={() => {
          onOpen();
          setLoading(true);
          setHistory(undefined);
          setMessage("");
          setOpen(true);
        }}
      >
        ▤ <span>Match decks</span>
      </button>
      <dialog
        ref={dialog}
        className="replay-history-decks-dialog"
        aria-label="Match decks"
        onKeyDown={(event) => event.stopPropagation()}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="replay-history-decks-heading">
          <div>
            <small>POST-GAME REVIEW</small>
            <h2>Match decks</h2>
            <p>Full lists and sideboarding · visible only to you</p>
          </div>
          <button type="button" aria-label="Close match decks" onClick={() => dialog.current?.close()}>
            ×
          </button>
        </div>
        {loading ? (
          <p role="status" className="replay-history-decks-status">
            Loading match decks…
          </p>
        ) : history ? (
          <AtlasHistoryDecks key={replayId} history={history} initialGame={gameNumber} />
        ) : (
          <p role="status" className="replay-history-decks-status">
            {message}
          </p>
        )}
      </dialog>
    </>
  );
}
