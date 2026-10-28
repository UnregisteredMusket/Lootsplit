import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Button } from "./ui";
import "./campaign-loading.css";
import {
  LOADING_SCREEN_BYTES,
  getRoomLoadingState,
  pauseRoomLoading,
  resumeRoomLoading,
  subscribeRoomLoading,
} from "@/lib/quire/room-loading";
import { refreshShared } from "@/lib/quire/cloud-client";

const megabytes = (bytes: number) =>
  `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;

/**
 * Loading screen for a large shared campaign (sectioned storage step 3). Shown while a first load
 * or catch-up downloads at least `LOADING_SCREEN_BYTES` of campaign sections (room-loading.ts):
 * progress in MB and parts, "Keep waiting" (the load continues behind a small progress pill) and
 * "Go back" (pauses downloads for that campaign in this tab and returns to the previous screen;
 * "Continue loading" resumes). Mounted once by the root document.
 */
export function CampaignLoadingHost() {
  const { loading, paused } = useSyncExternalStore(
    subscribeRoomLoading,
    getRoomLoadingState,
    getRoomLoadingState,
  );
  const [minimized, setMinimized] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const router = useRouter();
  const navigate = useNavigate();
  const large = !!loading && loading.totalBytes >= LOADING_SCREEN_BYTES;
  // A short delay so a fast connection never flashes the screen.
  useEffect(() => {
    if (!large) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 250);
    return () => window.clearTimeout(timer);
  }, [large]);
  if (paused && !loading)
    return (
      <div className="campaign-loading-pill" role="status" data-campaign-loading="paused">
        <span>Loading this large campaign is paused.</span>
        <Button
          variant="secondary"
          onClick={() => {
            resumeRoomLoading();
            void refreshShared().catch(() => {});
          }}
        >
          Continue loading
        </Button>
      </div>
    );
  if (!loading || !large || !visible) return null;
  const percent = loading.totalBytes
    ? Math.round((loading.loadedBytes / loading.totalBytes) * 100)
    : 0;
  const detail = `${megabytes(loading.loadedBytes)} of ${megabytes(loading.totalBytes)} · ${loading.loadedSections} of ${loading.totalSections} parts`;
  const bar = (
    <div
      className="campaign-loading-bar"
      role="progressbar"
      aria-label="Campaign download"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={detail}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
  if (minimized === loading.startedAt)
    return (
      <div className="campaign-loading-pill" role="status" data-campaign-loading="background">
        <span>Loading campaign… {percent}%</span>
        {bar}
      </div>
    );
  return (
    <div className="campaign-loading" data-campaign-loading="screen">
      <section
        className="campaign-loading-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-loading-title"
        aria-describedby="campaign-loading-message"
      >
        <img src="/brand/kobold-icon-128.png" width="56" height="56" alt="" />
        <h2 id="campaign-loading-title" className="font-display">
          Loading a large campaign
        </h2>
        <p id="campaign-loading-message">
          This campaign has a long history, so its first load takes a little longer. Later updates
          download only what changed.
        </p>
        {bar}
        <p className="campaign-loading-detail" role="status" aria-live="polite">
          {detail}
        </p>
        <div className="campaign-loading-actions">
          <Button
            variant="secondary"
            onClick={() => {
              pauseRoomLoading(loading.code);
              if (router.history.canGoBack()) router.history.back();
              else void navigate({ to: "/", search: { view: "home" } });
            }}
          >
            Go back
          </Button>
          <Button autoFocus onClick={() => setMinimized(loading.startedAt)}>
            Keep waiting
          </Button>
        </div>
      </section>
    </div>
  );
}
