"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";

import { MetaStudioCanvas } from "@/components/meta-studio/MetaStudioCanvas";
import styles from "@/components/meta-studio/MetaStudio.module.css";
import { RiftLiteAuthPanel } from "@/components/site/riftlite-auth-panel";
import {
  defaultMetaStudioSeason,
  type MetaStudioFilters,
  type MetaStudioReport,
} from "@/lib/community/meta-studio";

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
    <MetaStudioCanvas
      error={error}
      filters={filters}
      loading={loading}
      onFiltersChange={(nextFilters) => {
        setLoading(true);
        setError("");
        setFilters(nextFilters);
      }}
      onRefresh={() => {
        setLoading(true);
        setError("");
        setRefreshKey((value) => value + 1);
      }}
      onLock={() => void lockStudio()}
      preview={Boolean(previewReport)}
      report={report}
    />
  );
}
