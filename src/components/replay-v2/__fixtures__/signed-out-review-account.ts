/** Existing player tests exercise the independent, signed-out browser-note path. */
export function useReplayAccountReview({ replayId }: { replayId: string }) {
  return {
    status: "signed-out" as const, accountId: null, boundaryKey: `${replayId}:guest`, sessionKey: 0,
    review: null, notes: [], saving: false, error: "", conflict: null, pendingNotes: null, hasPendingChanges: false,
    saveReview: async () => false, saveNotes: async () => false, refresh: async () => false,
    reloadLatest: async () => false, retryDraft: async () => false,
  };
}
