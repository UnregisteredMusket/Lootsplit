import { useSyncExternalStore } from "react";
import { localAudioLibrary, localAudioPlayer } from "@/lib/quire/local-audio";
import { AppLink } from "./app-link";
export function LocalAudioMini() {
  const player = useSyncExternalStore(
    localAudioPlayer.subscribe,
    localAudioPlayer.getSnapshot,
    localAudioPlayer.getServerSnapshot,
  );
  const saved = useSyncExternalStore(
    localAudioLibrary.subscribe,
    localAudioLibrary.getSnapshot,
    localAudioLibrary.getServerSnapshot,
  );
  if (player.status === "stopped") return null;
  const track = saved.library?.tracks.find((x) => x.id === player.trackId);
  return (
    <aside className="local-audio-mini" aria-label="Active local playlist">
      <AppLink href="/features/music">
        {track?.title || "Local playlist"}
        <small>{player.status}</small>
      </AppLink>
      <button
        onClick={() => {
          if (player.status === "playing") localAudioPlayer.pause();
          else if (player.playlistId) void localAudioPlayer.play(player.playlistId, player.trackId);
        }}
      >
        {player.status === "playing" ? "Pause" : "Play"}
      </button>
      <button onClick={() => localAudioPlayer.stop()}>Stop</button>
    </aside>
  );
}
