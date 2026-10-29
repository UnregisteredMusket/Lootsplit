import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Button } from "./ui";
import "./campaign-loading.css";
import {
  LOADING_SCREEN_BYTES,
  announcedLoadingStep,
  formatLoadingPercent,
  getRoomLoadingState,
  loadingPercent,
  pauseRoomLoading,
  resumeRoomLoading,
  roomLoadingComplete,
  subscribeRoomLoading,
} from "@/lib/quire/room-loading";
import { refreshShared } from "@/lib/quire/cloud-client";

const megabytes = (bytes: number) =>
  `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;

/** The two layers cut from the brand mascot (docs/brand/01-mascot-chase-2048.png). */
const CHASE_LAYERS = ["/brand/chase-adventurer.webp", "/brand/chase-kobold.webp"] as const;

/**
 * The brand chase, running in place: the adventurer chases the kobold and its stolen coin. Two
 * stacked layers that together are the mascot art, each with a stride (bounce, lean and squash,
 * offset between the two), dust at their feet, motion streaks and a scrolling ground line. With
 * reduced motion it is the still mascot. Decorative: the text below carries the progress.
 */
function LoadingChase() {
  return (
    <div className="campaign-loading-chase" data-campaign-loading-chase aria-hidden="true">
      <span className="chase-ground" />
      <span className="chase-streak chase-streak-a" />
      <span className="chase-streak chase-streak-b" />
      <span className="chase-streak chase-streak-c" />
      <span className="chase-figure chase-adventurer">
        <img src={CHASE_LAYERS[0]} width="640" height="460" alt="" decoding="async" />
      </span>
      <span className="chase-dust chase-dust-adventurer" />
      <span className="chase-figure chase-kobold">
        <img src={CHASE_LAYERS[1]} width="640" height="460" alt="" decoding="async" />
      </span>
      <span className="chase-dust chase-dust-kobold" />
    </div>
  );
}

/**
 * Loading screen for a large shared campaign (sectioned storage step 3). Shown while a first load
 * or catch-up downloads at least `LOADING_SCREEN_BYTES` of campaign sections (room-loading.ts):
 * the brand chase, "Loading your campaign… 42%/100%" from the real bytes, MB and parts as
 * secondary detail, "Keep waiting" (the load continues behind a small progress pill) and
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
  // A short delay so a fast connection never flashes the screen; the art starts downloading now.
  useEffect(() => {
    if (!large) {
      setVisible(false);
      return;
    }
    for (const src of CHASE_LAYERS) new Image().src = src;
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
  const percent = loadingPercent(
    loading.loadedBytes,
    loading.totalBytes,
    roomLoadingComplete(loading),
  );
  const shown = formatLoadingPercent(percent);
  const detail = `${megabytes(loading.loadedBytes)} of ${megabytes(loading.totalBytes)} · ${loading.loadedSections} of ${loading.totalSections} parts`;
  const bar = (
    <div
      className="campaign-loading-bar"
      role="progressbar"
      aria-label="Campaign download"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% · ${detail}`}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
  // Announced politely every 10 %, not on every downloaded part.
  const announcement = (
    <p className="sr-only" role="status" aria-live="polite" data-campaign-loading-announce>
      Loading your campaign: {announcedLoadingStep(percent)}% loaded.
    </p>
  );
  if (minimized === loading.startedAt)
    return (
      <div className="campaign-loading-pill" data-campaign-loading="background">
        <span>
          Loading your campaign…{" "}
          <span className="campaign-loading-percent" data-campaign-loading-percent>
            {shown}
          </span>
        </span>
        {bar}
        {announcement}
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
        <LoadingChase />
        <h2 className="campaign-loading-line">
          <span id="campaign-loading-title" className="font-display">
            Loading your campaign…
          </span>{" "}
          <span className="campaign-loading-percent" data-campaign-loading-percent>
            {shown}
          </span>
        </h2>
        {bar}
        <p className="campaign-loading-detail">{detail}</p>
        {announcement}
        <p id="campaign-loading-message">
          This campaign has a long history, so its first load takes a little longer. Later updates
          download only what changed.
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
