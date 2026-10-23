import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

export const PROMO_VIDEO_WEBM = "/media/lootsplitter-promo.webm";
export const PROMO_VIDEO_MP4 = "/media/lootsplitter-promo.mp4";
export const PROMO_POSTER = "/media/lootsplitter-promo-poster.webp";

/**
 * The 32-second silent promo (owner's video, 2026-10-23) in the home hero. Website only:
 * the app keeps its own title animation. It plays muted and loops; visitors who ask for
 * reduced motion see the poster until they press play, and anyone can pause it (WCAG 2.2.2).
 */
export function PromoVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    element.muted = true;
    void element.play().catch(() => {
      // Autoplay refused (data saver, browser policy): the poster and play button remain.
    });
  }, []);

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
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
        preload="metadata"
        aria-label="Lootsplitter in 30 seconds: the website, splitting loot, character sheets, shops and trade, and battle maps"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        {/* VP9 for browsers without H.264 (some Chromium builds); H.264 for older Safari. */}
        <source src={PROMO_VIDEO_WEBM} type="video/webm" />
        <source src={PROMO_VIDEO_MP4} type="video/mp4" />
      </video>
      <button
        type="button"
        className="ls-promo-toggle"
        onClick={toggle}
        aria-label={playing ? "Pause the video" : "Play the video"}
      >
        {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
      </button>
    </figure>
  );
}
