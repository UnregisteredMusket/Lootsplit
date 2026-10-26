import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

export const PROMO_VIDEO_WEBM = "/media/lootsplitter-promo.webm";
export const PROMO_VIDEO_MP4 = "/media/lootsplitter-promo.mp4";
export const PROMO_POSTER = "/media/lootsplitter-promo-poster.webp";

/** Phones (the website's single-column layout) get the poster first (W-5). */
const PHONE_QUERY = "(max-width: 699px)";

/** Poster only, with tap to play: phones, data saver, and reduced motion. */
function posterFirst() {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const phone = window.matchMedia?.(PHONE_QUERY).matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  return !!(reduce || phone || saveData);
}

/**
 * The 32-second silent promo (owner's video, 2026-10-23) in the home hero. Website only:
 * the app keeps its own title animation. Nothing is downloaded until the video is on screen
 * (preload="none"). On larger screens it then plays muted and loops; on phones, with data saver
 * or with reduced motion the poster stays until the visitor taps play (W-5). Anyone can pause it
 * (WCAG 2.2.2).
 */
export function PromoVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // Started at least once: the small pause/play control replaces the large play button.
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element || posterFirst()) {
      setWaiting(true);
      return;
    }
    element.muted = true;
    const start = () =>
      void element.play().catch(() => {
        // Autoplay refused (browser policy): the poster and play button remain.
        setWaiting(true);
      });
    if (typeof IntersectionObserver === "undefined") {
      start();
      return;
    }
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      seen.disconnect();
      start();
    });
    seen.observe(element);
    return () => seen.disconnect();
  }, []);

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      element.muted = true;
      void element.play().catch(() => undefined);
    } else element.pause();
  };

  return (
    <figure className="ls-promo">
      <video
        ref={video}
        className="ls-promo-video"
        poster={PROMO_POSTER}
        width={540}
        height={960}
        muted
        loop
        playsInline
        preload="none"
        aria-label="Lootsplitter in 30 seconds: the website, splitting loot, character sheets, shops and trade, and battle maps"
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
        }}
        onPause={() => setPlaying(false)}
      >
        {/* VP9 for browsers without H.264 (some Chromium builds); H.264 for older Safari. */}
        <source src={PROMO_VIDEO_WEBM} type="video/webm" />
        <source src={PROMO_VIDEO_MP4} type="video/mp4" />
      </video>
      {waiting && !started ? (
        <button type="button" className="ls-promo-start" onClick={toggle}>
          <span className="ls-promo-start-icon">
            <Play size={26} aria-hidden="true" />
          </span>
          <span className="ls-promo-start-label">Play the video</span>
        </button>
      ) : (
        <button
          type="button"
          className="ls-promo-toggle"
          onClick={toggle}
          aria-label={playing ? "Pause the video" : "Play the video"}
        >
          {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>
      )}
    </figure>
  );
}
