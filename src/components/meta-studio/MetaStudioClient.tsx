"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { ExternalLink, Plus, RadioTower, RefreshCw, Save, Trash2, X } from "lucide-react";

import { MetaStudioCanvas } from "@/components/meta-studio/MetaStudioCanvas";
import styles from "@/components/meta-studio/MetaStudio.module.css";
import { RiftLiteAuthPanel } from "@/components/site/riftlite-auth-panel";
import {
  defaultMetaStudioSeason,
  type MetaStudioFilters,
  type MetaStudioReport,
} from "@/lib/community/meta-studio";
import {
  DEFAULT_LIVE_TAKEOVER_CONFIG,
  type LiveTakeoverConfig,
  type PublicLiveTakeover,
} from "@/lib/live-takeover";
import type { LiveTakeoverAnalyticsReport } from "@/lib/live-takeover-analytics";
import type { StreamStatus } from "@/lib/types";
import {
  DEFAULT_CREATOR_VIDEO_CAROUSEL_CONFIG,
  type CreatorVideoCarouselConfig,
  type CreatorVideoCreatorConfig,
} from "@/lib/youtube/creator-video-config";
import type { CreatorVideoCreatorPreview } from "@/lib/youtube/creator-video-feed";

const DEFAULT_FILTERS: MetaStudioFilters = {
  range: "7d",
  season: defaultMetaStudioSeason(),
  format: "all",
  platform: "all",
  minSample: 5,
};

type MetaStudioClientProps = {
  initialAuthorized: boolean;
  previewReport?: MetaStudioReport | null;
};

function reportQuery(filters: MetaStudioFilters) {
  return new URLSearchParams({
    range: filters.range,
    season: filters.season,
    format: filters.format,
    platform: filters.platform,
    minSample: String(filters.minSample),
  });
}

function copyCreatorVideoConfig(
  config: CreatorVideoCarouselConfig,
): CreatorVideoCarouselConfig {
  return {
    ...config,
    excludedVideoIds: [...config.excludedVideoIds],
    includedVideoIds: [...config.includedVideoIds],
    pinnedVideoIds: [...config.pinnedVideoIds],
    creators: config.creators.map((creator) => ({ ...creator })),
  };
}

function videoIdList(value: string) {
  return Array.from(new Set(
    value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function unusedCreatorId(creators: CreatorVideoCreatorConfig[]) {
  const taken = new Set(creators.map((creator) => creator.id));
  let suffix = creators.length + 1;
  while (taken.has(`creator-${suffix}`)) suffix += 1;
  return `creator-${suffix}`;
}

function newCreator(creators: CreatorVideoCreatorConfig[]): CreatorVideoCreatorConfig {
  return {
    id: unusedCreatorId(creators),
    name: "",
    spotlightId: "",
    youtubeUrl: "",
    channelId: "",
    sourceMode: "riftbound",
    playlistId: "",
    enabled: true,
    videoSlots: 1,
  };
}

function addVideoId(ids: string[], videoId: string) {
  return ids.includes(videoId) ? ids : [...ids, videoId];
}

function removeVideoId(ids: string[], videoId: string) {
  return ids.filter((id) => id !== videoId);
}

type CreatorVideoConfigResponse = {
  config: CreatorVideoCarouselConfig;
  preview: CreatorVideoCreatorPreview[];
};

type LiveTakeoverResponse = {
  config: LiveTakeoverConfig;
  liveTakeover: PublicLiveTakeover;
  streamStatus: StreamStatus;
  message?: string;
};

type LiveTakeoverAnalyticsResponse = {
  report: LiveTakeoverAnalyticsReport;
};

type LiveTakeoverPanelProps = {
  onClose: () => void;
};

export function LiveTakeoverPanel({ onClose }: LiveTakeoverPanelProps) {
  const [config, setConfig] = useState<LiveTakeoverConfig>({
    ...DEFAULT_LIVE_TAKEOVER_CONFIG,
  });
  const [liveTakeover, setLiveTakeover] = useState<PublicLiveTakeover | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [analyticsReport, setAnalyticsReport] = useState<LiveTakeoverAnalyticsReport | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState("");

  const applyResponse = useCallback((payload: LiveTakeoverResponse) => {
    setConfig({ ...payload.config });
    setLiveTakeover(payload.liveTakeover);
    setStreamStatus(payload.streamStatus);
    if (payload.message) setFeedback(payload.message);
  }, []);

  const requestConfig = useCallback(async () => {
    const response = await fetch("/api/meta-studio/live-takeover", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await response.json() as Partial<LiveTakeoverResponse> & { error?: string };
    if (!response.ok || !payload.config || !payload.liveTakeover || !payload.streamStatus) {
      throw new Error(payload.error ?? "Live takeover settings could not be loaded.");
    }
    return payload as LiveTakeoverResponse;
  }, []);

  const requestAnalytics = useCallback(async (runId?: string) => {
    const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    const response = await fetch(`/api/meta-studio/live-takeover/analytics${query}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await response.json() as Partial<LiveTakeoverAnalyticsResponse> & { error?: string };
    if (!response.ok || !payload.report) {
      throw new Error(payload.error ?? "Live takeover analytics could not be loaded.");
    }
    return payload.report;
  }, []);

  useEffect(() => {
    let mounted = true;
    void requestConfig()
      .then((payload) => {
        if (mounted) applyResponse(payload);
      })
      .catch((reason: unknown) => {
        if (mounted) {
          setError(reason instanceof Error
            ? reason.message
            : "Live takeover settings could not be loaded.");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [applyResponse, requestConfig]);

  const refreshAnalytics = useCallback(async (runId?: string) => {
    setAnalyticsLoading(true);
    setAnalyticsError("");
    try {
      setAnalyticsReport(await requestAnalytics(runId));
    } catch (reason) {
      setAnalyticsError(reason instanceof Error
        ? reason.message
        : "Live takeover analytics could not be loaded.");
    } finally {
      setAnalyticsLoading(false);
    }
  }, [requestAnalytics]);

  useEffect(() => {
    let mounted = true;
    void requestAnalytics()
      .then((report) => {
        if (mounted) setAnalyticsReport(report);
      })
      .catch((reason: unknown) => {
        if (mounted) {
          setAnalyticsError(reason instanceof Error
            ? reason.message
            : "Live takeover analytics could not be loaded.");
        }
      })
      .finally(() => {
        if (mounted) setAnalyticsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [requestAnalytics]);

  const refreshConfig = useCallback(async () => {
    setLoading(true);
    setError("");
    setFeedback("");
    try {
      const payload = await requestConfig();
      applyResponse(payload);
      void refreshAnalytics();
      setFeedback("Live takeover settings and Twitch status refreshed.");
    } catch (reason) {
      setError(reason instanceof Error
        ? reason.message
        : "Live takeover settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [applyResponse, refreshAnalytics, requestConfig]);

  async function saveConfig(nextConfig: LiveTakeoverConfig = config) {
    setSaving(true);
    setError("");
    setFeedback(nextConfig.enabled
      ? "Checking Twitch and arming the live takeover..."
      : "Ending the live takeover...");
    try {
      const response = await fetch("/api/meta-studio/live-takeover", {
        method: "PUT",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: nextConfig }),
      });
      const payload = await response.json() as Partial<LiveTakeoverResponse> & { error?: string };
      if (!response.ok || !payload.config || !payload.liveTakeover || !payload.streamStatus) {
        throw new Error(payload.error ?? "Live takeover settings could not be saved.");
      }
      applyResponse(payload as LiveTakeoverResponse);
      void refreshAnalytics(payload.config.analyticsRunId);
    } catch (reason) {
      setFeedback("");
      setError(reason instanceof Error
        ? reason.message
        : "Live takeover settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const busy = loading || saving;
  const savedEnabled = liveTakeover?.enabled ?? false;
  const state = liveTakeover?.active
    ? "active"
    : savedEnabled
      ? streamStatus?.state === "unavailable" ? "unavailable" : "armed"
      : "disabled";
  const stateTitle = state === "active"
    ? "Live on RiftLite"
    : state === "armed"
      ? "Armed — waiting for Twitch"
      : state === "unavailable"
        ? "Armed — Twitch status unavailable"
        : "Takeover off";
  const stateDescription = state === "active"
    ? "Desktop Home is replacing the YouTube carousel with the muted live stream."
    : state === "armed"
      ? "Desktop Home will switch automatically as soon as Twitch reports this channel live."
      : state === "unavailable"
        ? "The carousel remains visible until Twitch can safely confirm the channel is live."
        : "Desktop Home continues to show the normal creator video carousel.";
  const analyticsSummary = analyticsReport?.summary;

  return (
    <div aria-labelledby="live-takeover-panel-title" aria-modal="true" className={styles.creatorConfigBackdrop} role="dialog">
      <section className={`${styles.creatorConfigPanel} ${styles.liveTakeoverPanel}`}>
        <header className={styles.creatorConfigHeader}>
          <div>
            <span>DESKTOP HOME CONTENT</span>
            <h2 id="live-takeover-panel-title">Live stream takeover</h2>
            <p>
              Arm a Twitch stream for Desktop Home. RiftLite only takes over the video slot
              after Twitch confirms the channel is live, then starts it muted.
            </p>
          </div>
          <button aria-label="Close live takeover settings" className={styles.creatorIconButton} onClick={onClose} type="button">
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <div className={styles.creatorConfigToolbar}>
          <div className={styles.liveTakeoverSummary} data-state={state}>
            <span className={styles.liveTakeoverPulse} />
            <div>
              <strong>{stateTitle}</strong>
              <small>{stateDescription}</small>
            </div>
          </div>
          <div className={styles.creatorConfigActions}>
            <button disabled={busy} onClick={() => void refreshConfig()} type="button">
              <RefreshCw aria-hidden="true" className={loading ? styles.spinning : ""} size={16} />
              Refresh
            </button>
            <button
              className={savedEnabled ? styles.liveTakeoverStopButton : styles.creatorPrimaryButton}
              disabled={busy}
              onClick={() => void saveConfig({ ...config, enabled: !savedEnabled })}
              type="button"
            >
              <RadioTower aria-hidden="true" size={16} />
              {savedEnabled ? "End takeover" : "Go live on RiftLite"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className={styles.creatorConfigLoading}>Loading live takeover settings...</div>
        ) : (
          <fieldset className={`${styles.creatorConfigBody} ${styles.liveTakeoverBody}`} disabled={saving}>
            <label className={styles.creatorToggleField}>
              <span>
                <strong>Enable live takeover</strong>
                <small>This master switch never overrides Twitch&apos;s live check.</small>
              </span>
              <input
                aria-label="Enable live takeover"
                checked={config.enabled}
                onChange={(event) => {
                  setConfig((current) => ({ ...current, enabled: event.target.checked }));
                  setFeedback("Unsaved changes.");
                  setError("");
                }}
                type="checkbox"
              />
            </label>

            <div className={styles.liveTakeoverFields}>
              <label className={styles.creatorField}>
                <span>Provider</span>
                <select aria-label="Live takeover provider" disabled value={config.provider}>
                  <option value="twitch">Twitch</option>
                </select>
                <small>YouTube support can be added later without accepting arbitrary player URLs.</small>
              </label>
              <label className={styles.creatorField}>
                <span>Twitch channel</span>
                <input
                  aria-label="Twitch channel login"
                  autoCapitalize="none"
                  maxLength={25}
                  minLength={4}
                  onChange={(event) => {
                    setConfig((current) => ({ ...current, channelLogin: event.target.value }));
                    setFeedback("Unsaved changes.");
                    setError("");
                  }}
                  placeholder="bmucasts"
                  spellCheck={false}
                  value={config.channelLogin}
                />
                <small>Use the channel login only — no @, URL, embed code, or player HTML.</small>
              </label>
              <label className={`${styles.creatorField} ${styles.liveTakeoverTitleField}`}>
                <span>Desktop title</span>
                <input
                  aria-label="Live takeover title"
                  maxLength={120}
                  onChange={(event) => {
                    setConfig((current) => ({ ...current, title: event.target.value }));
                    setFeedback("Unsaved changes.");
                    setError("");
                  }}
                  placeholder="BMU Casts is live"
                  value={config.title}
                />
              </label>
            </div>

            <div className={styles.liveTakeoverSafety}>
              <RadioTower aria-hidden="true" size={21} />
              <div>
                <strong>Twitch status: {streamStatus?.state ?? "unavailable"}</strong>
                <span>{streamStatus?.tooltip ?? "Twitch status has not been checked yet."}</span>
              </div>
              <a href={`https://www.twitch.tv/${config.channelLogin || "bmucasts"}`} rel="noreferrer" target="_blank">
                Open channel <ExternalLink aria-hidden="true" size={14} />
              </a>
            </div>

            <section aria-label="Private live takeover analytics" className={styles.liveTakeoverAnalytics}>
              <div className={styles.liveTakeoverAnalyticsHeader}>
                <div>
                  <span>PRIVATE ANALYTICS</span>
                  <h3>RiftLite viewers and watch time</h3>
                  <p>Anonymous, run-scoped playback data from desktops with diagnostics enabled.</p>
                </div>
                <div className={styles.liveTakeoverAnalyticsActions}>
                  {analyticsReport?.runs.length ? (
                    <label>
                      <span>Takeover</span>
                      <select
                        aria-label="Analytics takeover run"
                        onChange={(event) => void refreshAnalytics(event.target.value)}
                        value={analyticsReport.selectedRunId ?? ""}
                      >
                        {analyticsReport.runs.map((run) => (
                          <option key={run.id} value={run.id}>
                            {run.title} · {run.startedAt ? new Date(run.startedAt).toLocaleDateString() : run.channelLogin}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <button
                    disabled={analyticsLoading}
                    onClick={() => void refreshAnalytics(analyticsReport?.selectedRunId ?? undefined)}
                    type="button"
                  >
                    <RefreshCw aria-hidden="true" className={analyticsLoading ? styles.spinning : ""} size={15} />
                    Refresh stats
                  </button>
                </div>
              </div>
              {analyticsError ? (
                <p className={styles.creatorConfigError}>{analyticsError}</p>
              ) : analyticsLoading && !analyticsSummary ? (
                <p className={styles.creatorConfigLoading}>Loading private viewer analytics...</p>
              ) : (
                <div className={styles.liveTakeoverAnalyticsGrid}>
                  <div><strong>{analyticsSummary?.currentViewers ?? 0}</strong><span>Watching now</span></div>
                  <div><strong>{analyticsSummary?.uniqueViewers ?? 0}</strong><span>Unique viewers</span></div>
                  <div><strong>{formatTakeoverWatchTime(analyticsSummary?.totalWatchSeconds ?? 0)}</strong><span>Total watch time</span></div>
                  <div><strong>{formatTakeoverWatchTime(analyticsSummary?.averageWatchSeconds ?? 0)}</strong><span>Average viewer</span></div>
                  <div><strong>{analyticsSummary?.peakConcurrent ?? 0}</strong><span>Peak viewers</span></div>
                  <div><strong>{analyticsSummary?.playbackStarts ?? 0}</strong><span>Playback starts</span></div>
                </div>
              )}
              <p className={styles.liveTakeoverAnalyticsPrivacy}>
                No IP addresses, accounts, usernames, Twitch identities, decks, or match data are stored. Current viewers use a 12-minute activity window.
              </p>
            </section>

            <div className={styles.liveTakeoverSaveRow}>
              <p>Saved changes usually reach active desktop clients within 30 seconds; allow up to about a minute if an edge cache is refreshing.</p>
              <button className={styles.creatorPrimaryButton} disabled={busy} onClick={() => void saveConfig()} type="button">
                <Save aria-hidden="true" size={16} />
                {saving ? "Saving..." : "Save settings"}
              </button>
            </div>
          </fieldset>
        )}

        <footer className={styles.creatorConfigFooter}>
          <p aria-live="polite" className={error ? styles.creatorConfigError : styles.creatorConfigFeedback} role="status">
            {error || feedback || "Changes are private until you save."}
          </p>
          <button disabled={busy} onClick={onClose} type="button">Close</button>
        </footer>
      </section>
    </div>
  );
}

function formatTakeoverWatchTime(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

type CreatorVideoCarouselPanelProps = {
  onClose: () => void;
};

export function CreatorVideoCarouselPanel({
  onClose,
}: CreatorVideoCarouselPanelProps) {
  const [config, setConfig] = useState<CreatorVideoCarouselConfig>(() =>
    copyCreatorVideoConfig(DEFAULT_CREATOR_VIDEO_CAROUSEL_CONFIG));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<CreatorVideoCreatorPreview[]>([]);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const requestConfig = useCallback(async () => {
    const response = await fetch("/api/meta-studio/creator-videos?preview=1", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await response.json() as {
      config?: CreatorVideoCarouselConfig;
      preview?: CreatorVideoCreatorPreview[];
      error?: string;
    };
    if (!response.ok || !payload.config) {
      throw new Error(payload.error ?? "Creator video carousel settings could not be loaded.");
    }
    return {
      config: copyCreatorVideoConfig(payload.config),
      preview: Array.isArray(payload.preview) ? payload.preview : [],
    } satisfies CreatorVideoConfigResponse;
  }, []);

  useEffect(() => {
    let mounted = true;
    void requestConfig()
      .then((result) => {
        if (mounted) {
          setConfig(result.config);
          setPreview(result.preview);
        }
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        setError(reason instanceof Error
          ? reason.message
          : "Creator video carousel settings could not be loaded.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [requestConfig]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError("");
    setFeedback("");
    try {
      const result = await requestConfig();
      setConfig(result.config);
      setPreview(result.preview);
      setFeedback("Creator video settings and feed preview refreshed.");
    } catch (reason) {
      setError(reason instanceof Error
        ? reason.message
        : "Creator video carousel settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [requestConfig]);

  function updateConfig(patch: Partial<CreatorVideoCarouselConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
    setError("");
    setFeedback("Unsaved changes.");
  }

  function updateCreator(
    index: number,
    patch: Partial<CreatorVideoCreatorConfig>,
  ) {
    setConfig((current) => ({
      ...current,
      creators: current.creators.map((creator, creatorIndex) =>
        creatorIndex === index ? { ...creator, ...patch } : creator),
    }));
    setError("");
    setFeedback("Unsaved changes.");
  }

  function updatePreviewVideo(videoId: string, action: "include" | "exclude") {
    setConfig((current) => action === "include"
      ? {
          ...current,
          includedVideoIds: addVideoId(current.includedVideoIds, videoId),
          excludedVideoIds: removeVideoId(current.excludedVideoIds, videoId),
        }
      : {
          ...current,
          excludedVideoIds: addVideoId(current.excludedVideoIds, videoId),
          includedVideoIds: removeVideoId(current.includedVideoIds, videoId),
          pinnedVideoIds: removeVideoId(current.pinnedVideoIds, videoId),
        });
    setPreview((current) => current.map((creator) => ({
      ...creator,
      items: creator.items.map((item) => item.videoId === videoId
        ? {
            ...item,
            status: action === "include" ? "included" : "excluded",
            reason: action === "include" ? "Allowed manually" : "Hidden manually",
          }
        : item),
    })));
    setError("");
    setFeedback(action === "include"
      ? "Video will always pass the Riftbound filter after you save."
      : "Video will be hidden after you save.");
  }

  async function saveConfig() {
    setSaving(true);
    setError("");
    setFeedback("Saving creator video carousel settings...");
    try {
      const response = await fetch("/api/meta-studio/creator-videos", {
        method: "PUT",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const payload = await response.json() as {
        config?: CreatorVideoCarouselConfig;
        error?: string;
        message?: string;
      };
      if (!response.ok || !payload.config) {
        throw new Error(payload.error ?? "Creator video carousel settings could not be saved.");
      }
      setConfig(copyCreatorVideoConfig(payload.config));
      setFeedback(payload.message ?? "Creator video carousel settings saved and Home refreshed.");
    } catch (reason) {
      setFeedback("");
      setError(reason instanceof Error
        ? reason.message
        : "Creator video carousel settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const busy = loading || saving;
  const enabledVideoCreators = config.creators.filter((creator) =>
    creator.enabled && (creator.sourceMode === "playlist"
      ? Boolean(creator.playlistId)
      : Boolean(creator.youtubeUrl || creator.channelId)));
  const totalVideoSlots = enabledVideoCreators.reduce(
    (total, creator) => total + Math.max(0, Math.trunc(Number(creator.videoSlots) || 0)),
    0,
  );

  return (
    <div aria-labelledby="creator-video-panel-title" aria-modal="true" className={styles.creatorConfigBackdrop} role="dialog">
      <section className={styles.creatorConfigPanel}>
        <header className={styles.creatorConfigHeader}>
          <div>
            <span>DESKTOP HOME CONTENT</span>
            <h2 id="creator-video-panel-title">Creator video carousel</h2>
            <p>
              Choose how RiftLite reads each creator&apos;s YouTube feed, then fill Home with
              the most relevant videos using the weights and exceptions below.
            </p>
          </div>
          <button aria-label="Close creator video carousel settings" className={styles.creatorIconButton} onClick={onClose} type="button">
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <div className={styles.creatorConfigToolbar}>
          <div className={styles.creatorConfigSummary}>
            <strong>{totalVideoSlots}</strong>
            <span>Total enabled video slots</span>
            <small>{enabledVideoCreators.length} of {config.creators.length} featured creators supplying videos</small>
          </div>
          <div className={styles.creatorConfigActions}>
            <button disabled={busy} onClick={() => void loadConfig()} type="button">
              <RefreshCw aria-hidden="true" className={loading ? styles.spinning : ""} size={16} />
              Refresh
            </button>
            <button className={styles.creatorPrimaryButton} disabled={busy} onClick={() => void saveConfig()} type="button">
              <Save aria-hidden="true" size={16} />
              {saving ? "Saving..." : "Save carousel"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className={styles.creatorConfigLoading}>Loading creator video settings...</div>
        ) : (
          <fieldset className={styles.creatorConfigBody} disabled={saving}>
            <div className={styles.creatorGlobalSettings}>
              <label className={styles.creatorToggleField}>
                <span>
                  <strong>Enable carousel</strong>
                  <small>Turn off to make desktop clients use their bundled fallback content.</small>
                </span>
                <input
                  aria-label="Enable creator video carousel"
                  checked={config.enabled}
                  onChange={(event) => updateConfig({ enabled: event.target.checked })}
                  type="checkbox"
                />
              </label>
              <label className={styles.creatorField}>
                <span>Rotation seconds</span>
                <input
                  aria-label="Rotation seconds"
                  max={120}
                  min={5}
                  onChange={(event) => updateConfig({ rotationSeconds: Math.trunc(Number(event.target.value) || 0) })}
                  step={1}
                  type="number"
                  value={config.rotationSeconds}
                />
              </label>
              <label className={styles.creatorField}>
                <span>Maximum items</span>
                <input
                  aria-label="Maximum carousel items"
                  max={24}
                  min={1}
                  onChange={(event) => updateConfig({ maxItems: Math.trunc(Number(event.target.value) || 0) })}
                  step={1}
                  type="number"
                  value={config.maxItems}
                />
              </label>
            </div>

            <div className={styles.creatorVideoIdGrid}>
              <label className={styles.creatorField}>
                <span>Pinned YouTube video IDs</span>
                <textarea
                  aria-label="Pinned YouTube video IDs"
                  onChange={(event) => updateConfig({ pinnedVideoIds: videoIdList(event.target.value) })}
                  placeholder="One 11-character video ID per line"
                  value={config.pinnedVideoIds.join("\n")}
                />
              </label>
              <label className={styles.creatorField}>
                <span>Excluded YouTube video IDs</span>
                <textarea
                  aria-label="Excluded YouTube video IDs"
                  onChange={(event) => updateConfig({ excludedVideoIds: videoIdList(event.target.value) })}
                  placeholder="One 11-character video ID per line"
                  value={config.excludedVideoIds.join("\n")}
                />
              </label>
              <label className={styles.creatorField}>
                <span>Always-include YouTube video IDs</span>
                <textarea
                  aria-label="Always include YouTube video IDs"
                  onChange={(event) => updateConfig({ includedVideoIds: videoIdList(event.target.value) })}
                  placeholder="Riftbound filter exceptions, one ID per line"
                  value={config.includedVideoIds.join("\n")}
                />
                <small>Lets a video through the Riftbound filter. Hidden IDs still take priority.</small>
              </label>
            </div>

            <div className={styles.creatorListHeader}>
              <div>
                <h3>Featured creators</h3>
                <p>
                  Keep a creator&apos;s social link canonical, then choose all uploads, automatic
                  Riftbound filtering, or a dedicated playlist. Four slots receives roughly four
                  times the selection opportunity of one slot.
                </p>
              </div>
              <button
                onClick={() => updateConfig({ creators: [...config.creators, newCreator(config.creators)] })}
                type="button"
              >
                <Plus aria-hidden="true" size={16} /> Add creator
              </button>
            </div>

            <div className={styles.creatorList}>
              {config.creators.map((creator, index) => (
                <article className={styles.creatorCard} key={`${creator.id}-${index}`}>
                  <div className={styles.creatorCardHeader}>
                    <div>
                      <span>CREATOR {index + 1}</span>
                      <strong>{creator.name || creator.id || "New creator"}</strong>
                    </div>
                    <div className={styles.creatorCardActions}>
                      <label>
                        <input
                          aria-label={`Enable creator ${index + 1}`}
                          checked={creator.enabled}
                          onChange={(event) => updateCreator(index, { enabled: event.target.checked })}
                          type="checkbox"
                        />
                        Enabled
                      </label>
                      <button
                        aria-label={`Remove ${creator.name || `creator ${index + 1}`}`}
                        onClick={() => updateConfig({ creators: config.creators.filter((_, creatorIndex) => creatorIndex !== index) })}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={15} /> Remove
                      </button>
                    </div>
                  </div>

                  <div className={styles.creatorFields}>
                    <label className={styles.creatorField}>
                      <span>Creator name</span>
                      <input
                        aria-label={`Creator ${index + 1} name`}
                        onChange={(event) => updateCreator(index, { name: event.target.value })}
                        placeholder="Riftlab"
                        value={creator.name}
                      />
                    </label>
                    <label className={styles.creatorField}>
                      <span>Creator ID</span>
                      <input
                        aria-label={`Creator ${index + 1} ID`}
                        onChange={(event) => updateCreator(index, { id: event.target.value })}
                        placeholder="riftlab"
                        value={creator.id}
                      />
                    </label>
                    <label className={`${styles.creatorField} ${styles.creatorWideField}`}>
                      <span>YouTube social link</span>
                      <input
                        aria-label={`Creator ${index + 1} YouTube URL`}
                        onChange={(event) => updateCreator(index, { youtubeUrl: event.target.value })}
                        placeholder="https://www.youtube.com/@creator"
                        type="url"
                        value={creator.youtubeUrl}
                      />
                      <small>{creator.sourceMode === "playlist"
                        ? "Used as the creator's public channel link; the playlist controls the feed."
                        : creator.youtubeUrl
                          ? "Recent channel uploads are collected automatically."
                        : "No YouTube link — this creator is not included in the video carousel."}</small>
                    </label>
                    <label className={styles.creatorField}>
                      <span>Channel ID (optional)</span>
                      <input
                        aria-label={`Creator ${index + 1} YouTube channel ID`}
                        onChange={(event) => updateCreator(index, { channelId: event.target.value })}
                        placeholder="UC..."
                        value={creator.channelId}
                      />
                    </label>
                    <label className={styles.creatorField}>
                      <span>Video slots</span>
                      <input
                        aria-label={`Creator ${index + 1} video slots`}
                        max={8}
                        min={1}
                        onChange={(event) => updateCreator(index, { videoSlots: Math.trunc(Number(event.target.value) || 0) })}
                        step={1}
                        type="number"
                        value={creator.videoSlots}
                      />
                    </label>
                    <label className={styles.creatorField}>
                      <span>Video source</span>
                      <select
                        aria-label={`Creator ${index + 1} source mode`}
                        onChange={(event) => updateCreator(index, {
                          sourceMode: event.target.value as CreatorVideoCreatorConfig["sourceMode"],
                        })}
                        value={creator.sourceMode}
                      >
                        <option value="riftbound">Riftbound only</option>
                        <option value="all">All uploads</option>
                        <option value="playlist">YouTube playlist</option>
                      </select>
                      <small>{creator.sourceMode === "riftbound"
                        ? "Uses title and description terms, plus manual exceptions."
                        : creator.sourceMode === "all"
                          ? "Allows every recent upload from this channel."
                          : "Allows every video returned by the selected playlist."}</small>
                    </label>
                    {creator.sourceMode === "playlist" ? (
                      <label className={`${styles.creatorField} ${styles.creatorWideField}`}>
                        <span>Playlist URL or ID</span>
                        <input
                          aria-label={`Creator ${index + 1} playlist URL or ID`}
                          onChange={(event) => updateCreator(index, { playlistId: event.target.value })}
                          placeholder="https://www.youtube.com/playlist?list=..."
                          value={creator.playlistId}
                        />
                        <small>Paste a YouTube playlist URL or its list ID.</small>
                      </label>
                    ) : null}
                  </div>
                </article>
              ))}
              {!config.creators.length ? (
                <div className={styles.creatorEmptyState}>No creators configured. Add one to begin the rotation.</div>
              ) : null}
            </div>

            <section aria-labelledby="creator-feed-preview-title" className={styles.creatorPreview}>
              <div className={styles.creatorPreviewHeader}>
                <div>
                  <h3 id="creator-feed-preview-title">Feed preview</h3>
                  <p>Review what the current saved sources return. Use Refresh after changing a source.</p>
                </div>
                <span>{preview.reduce((total, creator) => total + creator.items.length, 0)} videos checked</span>
              </div>
              <div className={styles.creatorPreviewGroups}>
                {preview.map((creator) => (
                  <section className={styles.creatorPreviewGroup} key={creator.creatorId}>
                    <header>
                      <div>
                        <strong>{creator.creatorName || creator.creatorId}</strong>
                        <span>{creator.sourceMode === "playlist" ? "Playlist" : creator.sourceMode === "all" ? "All uploads" : "Riftbound filter"}</span>
                      </div>
                      <em data-success={creator.succeeded}>{creator.succeeded ? `${creator.items.length} found` : "Feed unavailable"}</em>
                    </header>
                    {creator.error ? <p className={styles.creatorPreviewError}>{creator.error}</p> : null}
                    <div className={styles.creatorPreviewItems}>
                      {creator.items.map((item) => (
                        <article className={styles.creatorPreviewItem} key={`${creator.creatorId}-${item.videoId}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img alt="" loading="lazy" src={item.thumbnailUrl} />
                          <div className={styles.creatorPreviewCopy}>
                            <strong title={item.title}>{item.title}</strong>
                            <span data-status={item.status}>{item.status}</span>
                            <small>{item.reason}</small>
                          </div>
                          <button
                            aria-label={`${item.status === "included" ? "Hide" : "Always include"} ${item.title}`}
                            disabled={busy}
                            onClick={() => updatePreviewVideo(item.videoId, item.status === "included" ? "exclude" : "include")}
                            type="button"
                          >
                            {item.status === "included" ? "Hide" : "Always include"}
                          </button>
                        </article>
                      ))}
                      {creator.succeeded && !creator.items.length ? (
                        <p className={styles.creatorPreviewEmpty}>No recent videos were returned.</p>
                      ) : null}
                    </div>
                  </section>
                ))}
                {!preview.length ? (
                  <p className={styles.creatorPreviewEmpty}>
                    No enabled creator feeds are available to preview. Check the source settings, then refresh.
                  </p>
                ) : null}
              </div>
            </section>
          </fieldset>
        )}

        <footer className={styles.creatorConfigFooter}>
          <p aria-live="polite" className={error ? styles.creatorConfigError : styles.creatorConfigFeedback} role="status">
            {error || feedback || "Changes are private until you save."}
          </p>
          <button disabled={busy} onClick={onClose} type="button">Close</button>
        </footer>
      </section>
    </div>
  );
}

export function MetaStudioClient({
  initialAuthorized,
  previewReport = null,
}: MetaStudioClientProps) {
  const [authorized, setAuthorized] = useState(initialAuthorized || Boolean(previewReport));
  const [filters, setFilters] = useState<MetaStudioFilters>(
    previewReport?.filters ?? DEFAULT_FILTERS,
  );
  const [report, setReport] = useState<MetaStudioReport | null>(previewReport);
  const [loading, setLoading] = useState(initialAuthorized && !previewReport);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [creatorVideoPanelOpen, setCreatorVideoPanelOpen] = useState(false);
  const [liveTakeoverPanelOpen, setLiveTakeoverPanelOpen] = useState(false);
  const appliedFilters = useRef(previewReport?.filters ?? DEFAULT_FILTERS);
  const query = useMemo(() => reportQuery(filters).toString(), [filters]);

  const createSession = useCallback(async (user: User) => {
    const token = await user.getIdToken(true);
    const response = await fetch("/api/meta-studio/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Meta Studio access was not granted.");
    }
    setAuthorized(true);
    window.location.reload();
    return { message: "Opening Meta Studio..." };
  }, []);

  const lockStudio = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/meta-studio/session", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Meta Studio could not lock this session.");
      }
      setAuthorized(false);
      setReport(null);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Meta Studio could not lock this session.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authorized || previewReport) return;
    const controller = new AbortController();

    void fetch(`/api/meta-studio/report?${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as {
          report?: MetaStudioReport;
          error?: string;
        };
        if (!response.ok || !payload.report) {
          if (response.status === 401 || response.status === 403) {
            setAuthorized(false);
          }
          throw new Error(payload.error ?? "Meta Studio could not load this report.");
        }
        appliedFilters.current = payload.report.filters;
        setFilters(payload.report.filters);
        setReport(payload.report);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setFilters(appliedFilters.current);
        setError(reason instanceof Error ? reason.message : "Meta Studio could not load this report.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [authorized, previewReport, query, refreshKey]);

  if (!authorized) {
    return (
      <div className={styles.accessPage}>
        <div className={styles.accessGlow} />
        <div className={styles.accessBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="RiftLite" src="/brand/riftlite-logo-transparent.png" />
          <div>
            <span>PRIVATE REPORTING WORKSPACE</span>
            <h1>RiftLite Meta Studio</h1>
            <p>
              Sign in with the approved RiftLite account to open the community
              meta presenter.
            </p>
          </div>
        </div>
        <RiftLiteAuthPanel
          actionLabel="Open Meta Studio"
          description="This reporting workspace is currently restricted to BMU."
          onReady={createSession}
          readyTitle="Meta Studio access"
        />
      </div>
    );
  }

  if (!report && error) {
    return (
      <div className={styles.statePage}>
        <div className={styles.stateCard}>
          <span>RIFTLITE META STUDIO</span>
          <h1>The report did not load</h1>
          <p>{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError("");
              setRefreshKey((value) => value + 1);
            }}
            type="button"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className={styles.statePage}>
        <div className={styles.loadingMark}>
          <span />
          <strong>Building community report</strong>
        </div>
      </div>
    );
  }

  return (
    <>
      <MetaStudioCanvas
        error={error}
        filters={filters}
        loading={loading}
        onFiltersChange={(nextFilters) => {
          setLoading(true);
          setError("");
          setFilters(nextFilters);
        }}
        onOpenLiveTakeover={() => setLiveTakeoverPanelOpen(true)}
        onOpenCreatorVideos={() => setCreatorVideoPanelOpen(true)}
        onRefresh={() => {
          setLoading(true);
          setError("");
          setRefreshKey((value) => value + 1);
        }}
        onLock={() => void lockStudio()}
        preview={Boolean(previewReport)}
        report={report}
      />
      {creatorVideoPanelOpen ? (
        <CreatorVideoCarouselPanel onClose={() => setCreatorVideoPanelOpen(false)} />
      ) : null}
      {liveTakeoverPanelOpen ? (
        <LiveTakeoverPanel onClose={() => setLiveTakeoverPanelOpen(false)} />
      ) : null}
    </>
  );
}
