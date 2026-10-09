import { useState, useSyncExternalStore } from "react";
import {
  Music2,
  Play,
  Pause,
  SkipForward,
  Square,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react";
import { localAudioLibrary, localAudioPlayer } from "@/lib/quire/local-audio";
import {
  AUDIO_LICENSES,
  AUDIO_SCENES,
  type LocalAudioLibrary,
  type LocalTrack,
  type AudioScene,
  type AudioLicense,
  audioSource,
} from "@/lib/quire/local-audio-library";
import { usePrefs } from "@/lib/quire/prefs";
import { menuAudio } from "@/lib/quire/menu-audio";
import { Button } from "./ui";

function TrackCredits({ track }: { track: LocalTrack }) {
  return (
    <details className="local-audio-credits">
      <summary>Credits · {track.license}</summary>
      <p>
        {track.creator} · {track.license}
      </p>
      {track.source && (
        <a href={track.source} target="_blank" rel="noreferrer">
          Original source ↗
        </a>
      )}
      {track.license === "CC-BY-4.0" && (
        <p>
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            Creative Commons Attribution 4.0 ↗
          </a>
        </p>
      )}
      {track.notes && <p>{track.notes}</p>}
      {!track.bundled && (
        <small>License details recorded by you. Lootsplit does not verify permission.</small>
      )}
    </details>
  );
}

export function LocalAudioPanel() {
  const saved = useSyncExternalStore(
    localAudioLibrary.subscribe,
    localAudioLibrary.getSnapshot,
    localAudioLibrary.getServerSnapshot,
  );
  const player = useSyncExternalStore(
    localAudioPlayer.subscribe,
    localAudioPlayer.getSnapshot,
    localAudioPlayer.getServerSnapshot,
  );
  const { prefs, setPrefs } = usePrefs();
  const [selected, setSelected] = useState("exploration"),
    [name, setName] = useState(""),
    [file, setFile] = useState<File>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [deleteId, setDeleteId] = useState("");
  const [metadata, setMetadata] = useState({
    title: "",
    creator: "",
    source: "",
    license: "CC0-1.0" as AudioLicense,
    notes: "",
    permission: false,
  });
  const library = saved.library,
    playlist = library?.playlists.find((x) => x.id === selected) || library?.playlists[0];
  const now = library?.tracks.find((x) => x.id === player.trackId);
  async function action(task: () => Promise<void>, success = "Saved on this device.") {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await task();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Audio change could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  function change(edit: (library: LocalAudioLibrary) => void) {
    return action(() => localAudioLibrary.save(edit));
  }
  if (!library)
    return (
      <div className="local-audio-panel">
        <p role="status">
          {saved.loading
            ? "Opening your device audio library…"
            : saved.error || "Opening your device audio library…"}
        </p>
        {saved.error && (
          <Button onClick={() => void localAudioLibrary.load()}>Retry audio storage</Button>
        )}
      </div>
    );
  return (
    <div className="local-audio-panel">
      <p className="text-muted">
        Your audio library, saved on this device. Play through your speakers or headphones; players
        on other devices do not receive audio.
      </p>
      <div className="local-audio-layout">
        <section className="local-audio-card" aria-label="Playlists">
          <h2>
            <Music2 size={22} /> Playlists
          </h2>
          <div className="local-audio-playlists">
            {library.playlists.map((x) => (
              <button
                key={x.id}
                aria-pressed={x.id === playlist?.id}
                onClick={() => {
                  setSelected(x.id);
                  setDeleteId("");
                }}
              >
                {x.name}
                <small>{x.tracks.length} tracks</small>
              </button>
            ))}
          </div>
          <form
            className="local-audio-form"
            onSubmit={(e) => {
              e.preventDefault();
              const nextName = name.trim();
              if (!nextName) return;
              void action(async () => {
                const id = crypto.randomUUID();
                await localAudioLibrary.save((lib) => {
                  lib.playlists.push({ id, name: nextName, tracks: [] });
                });
                setSelected(id);
                setName("");
              });
            }}
          >
            <label>
              New playlist name
              <input
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <Button type="submit" disabled={busy || library.playlists.length >= 50}>
              <Plus size={16} /> Create playlist
            </Button>
          </form>
          {playlist && (
            <details className="local-audio-manage">
              <summary>Manage {playlist.name}</summary>
              <form
                className="local-audio-form"
                key={playlist.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void change((lib) => {
                    const item = lib.playlists.find((x) => x.id === playlist.id);
                    if (item) item.name = String(data.get("name")).trim();
                  });
                }}
              >
                <label>
                  Playlist name
                  <input name="name" defaultValue={playlist.name} maxLength={80} required />
                </label>
                <Button type="submit" disabled={busy}>
                  Rename playlist
                </Button>
              </form>
              {deleteId === playlist.id ? (
                <div>
                  <p>Delete this playlist? Its audio files stay in your library.</p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await localAudioLibrary.save((lib) => {
                          lib.playlists = lib.playlists.filter((x) => x.id !== playlist.id);
                          for (const scene of Object.keys(lib.assignments) as AudioScene[])
                            if (lib.assignments[scene] === playlist.id)
                              delete lib.assignments[scene];
                        });
                        setDeleteId("");
                      })
                    }
                  >
                    Confirm delete playlist
                  </Button>
                  <Button variant="secondary" onClick={() => setDeleteId("")}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setDeleteId(playlist.id)}>
                  Delete playlist
                </Button>
              )}
            </details>
          )}
        </section>
        <section className="local-audio-card" aria-label="Playlist player">
          <small className="text-muted">NOW PLAYING · {player.status}</small>
          <h2>{now?.title || playlist?.name || "Choose a playlist"}</h2>
          {now ? <TrackCredits track={now} /> : <p>Press Play when you are ready.</p>}
          <div className="local-audio-controls">
            <Button
              disabled={!playlist?.tracks.length}
              onClick={() => {
                if (player.status === "playing" && player.playlistId === playlist?.id)
                  localAudioPlayer.pause();
                else if (playlist) {
                  void menuAudio.unlock(true);
                  void localAudioPlayer.play(
                    playlist.id,
                    player.playlistId === playlist.id ? player.trackId : undefined,
                  );
                }
              }}
            >
              {player.status === "playing" && player.playlistId === playlist?.id ? (
                <>
                  <Pause size={18} /> Pause
                </>
              ) : (
                <>
                  <Play size={18} /> Play playlist
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              disabled={!player.trackId}
              onClick={() => localAudioPlayer.next()}
            >
              <SkipForward size={18} /> Next
            </Button>
            <Button
              variant="secondary"
              disabled={player.status === "stopped"}
              onClick={() => localAudioPlayer.stop()}
            >
              <Square size={16} /> Stop
            </Button>
          </div>
          <p className="text-sm text-muted">
            Pause holds your place. Stop returns to automatic menu audio. Background playback
            pauses; press Play to resume.
          </p>
          <div className="local-audio-mixer">
            <label>
              Playlist music · {Math.round(library.volume * 100)}%
              <input
                aria-label="Playlist music volume"
                type="range"
                min={0}
                max={100}
                value={Math.round(library.volume * 100)}
                disabled={busy}
                onChange={(e) => {
                  const value = Number(e.target.value) / 100;
                  void change((lib) => {
                    lib.volume = value;
                  });
                }}
              />
            </label>
            <label>
              Ambience · {Math.round(prefs.ambienceVolume * 100)}%
              <input
                aria-label="Playlist ambience volume"
                type="range"
                min={0}
                max={100}
                value={Math.round(prefs.ambienceVolume * 100)}
                onChange={(e) => setPrefs({ ambienceVolume: Number(e.target.value) / 100 })}
              />
            </label>
            <label className="local-audio-check">
              <input
                type="checkbox"
                checked={prefs.ambienceEnabled}
                onChange={(e) => {
                  setPrefs({ ambienceEnabled: e.target.checked });
                  if (e.target.checked) void menuAudio.unlock(true);
                }}
              />{" "}
              Enable ambience
            </label>
            <label>
              Ambience while playlist is active
              <select
                aria-label="Ambience while playlist is active"
                value={library.ambience}
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value as LocalAudioLibrary["ambience"];
                  void change((lib) => {
                    lib.ambience = value;
                  });
                }}
              >
                <option value="scene">Follow menu scene</option>
                <option value="fire">Fireplace</option>
                <option value="water">Water</option>
                <option value="crickets">Crickets</option>
                <option value="dungeon">Dungeon</option>
              </select>
            </label>
          </div>
          <div className="local-audio-controls">
            {(["repeat", "shuffle"] as const).map((key) => (
              <label className="local-audio-check" key={key}>
                <input
                  type="checkbox"
                  checked={library[key]}
                  disabled={busy}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    void change((lib) => {
                      lib[key] = checked;
                    });
                  }}
                />
                {key === "repeat" ? "Loop playlist" : "Shuffle"}
              </label>
            ))}
          </div>
          {player.error && <p role="alert">{player.error}</p>}
          {playlist && (
            <>
              <h3>
                {playlist.name} · {playlist.tracks.length} tracks
              </h3>
              <ol className="local-audio-tracks">
                {playlist.tracks.map((id, index) => {
                  const track = library.tracks.find((x) => x.id === id)!;
                  return (
                    <li key={id} className={player.trackId === id ? "current" : ""}>
                      <button
                        className="local-audio-track"
                        onClick={() => {
                          void menuAudio.unlock(true);
                          void localAudioPlayer.play(playlist.id, id);
                        }}
                      >
                        <Play size={16} />
                        <span>
                          {track.title}
                          <small>{track.creator}</small>
                        </span>
                      </button>
                      <TrackCredits track={track} />
                      <div className="local-audio-controls">
                        <button
                          aria-label={`Move ${track.title} up`}
                          disabled={busy || index === 0}
                          onClick={() =>
                            void change((lib) => {
                              const tracks = lib.playlists.find(
                                (x) => x.id === playlist.id,
                              )!.tracks;
                              const position = tracks.indexOf(id);
                              if (position > 0)
                                [tracks[position - 1], tracks[position]] = [
                                  tracks[position],
                                  tracks[position - 1],
                                ];
                            })
                          }
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          aria-label={`Move ${track.title} down`}
                          disabled={busy || index === playlist.tracks.length - 1}
                          onClick={() =>
                            void change((lib) => {
                              const tracks = lib.playlists.find(
                                (x) => x.id === playlist.id,
                              )!.tracks;
                              const position = tracks.indexOf(id);
                              if (position >= 0 && position < tracks.length - 1)
                                [tracks[position + 1], tracks[position]] = [
                                  tracks[position],
                                  tracks[position + 1],
                                ];
                            })
                          }
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          disabled={busy}
                          aria-label={`Remove ${track.title} from playlist`}
                          onClick={() =>
                            void change((lib) => {
                              const item = lib.playlists.find((x) => x.id === playlist.id)!;
                              item.tracks = item.tracks.filter((x) => x !== id);
                            })
                          }
                        >
                          <Trash2 size={16} /> Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {!playlist.tracks.length && (
                <p>This playlist is empty. Add library tracks or import audio below.</p>
              )}
              <label>
                Add a library track
                <select
                  aria-label="Add a library track"
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id)
                      void change((lib) => {
                        const item = lib.playlists.find((x) => x.id === playlist.id)!;
                        if (!item.tracks.includes(id)) item.tracks.push(id);
                      });
                  }}
                >
                  <option value="">Choose track…</option>
                  {library.tracks
                    .filter((x) => !playlist.tracks.includes(x.id))
                    .map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.title}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
        </section>
      </div>
      <section className="local-audio-card" aria-label="Import licensed audio">
        <h2>Add your audio</h2>
        <p>
          Choose audio you created or have permission to use. Record its creator, source and license
          for future reference.
        </p>
        <form
          className="local-audio-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file || !playlist || !metadata.permission) return;
            const form = e.currentTarget;
            void action(async () => {
              await localAudioLibrary.import(
                file,
                {
                  title: metadata.title.trim(),
                  creator: metadata.creator.trim(),
                  source: audioSource(metadata.source),
                  license: metadata.license,
                  notes: metadata.notes.trim(),
                },
                playlist.id,
              );
              setFile(undefined);
              setMetadata({
                title: "",
                creator: "",
                source: "",
                license: "CC0-1.0",
                notes: "",
                permission: false,
              });
              form.reset();
            }, "Audio added to your device library.");
          }}
        >
          <label>
            Audio file · up to 50 MB
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm"
              disabled={busy}
              onChange={(e) => {
                const next = e.target.files?.[0];
                setFile(next);
                if (next)
                  setMetadata((old) => ({ ...old, title: next.name.replace(/\.[^.]+$/, "") }));
              }}
              required
            />
          </label>
          {file && (
            <>
              <div className="local-audio-fields">
                <label>
                  Track title
                  <input
                    value={metadata.title}
                    maxLength={160}
                    required
                    onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                  />
                </label>
                <label>
                  Creator
                  <input
                    value={metadata.creator}
                    maxLength={160}
                    required
                    onChange={(e) => setMetadata({ ...metadata, creator: e.target.value })}
                  />
                </label>
                <label>
                  Source link (optional)
                  <input
                    type="url"
                    placeholder="https://"
                    value={metadata.source}
                    maxLength={1000}
                    onChange={(e) => setMetadata({ ...metadata, source: e.target.value })}
                  />
                </label>
                <label>
                  License
                  <select
                    aria-label="License"
                    value={metadata.license}
                    onChange={(e) =>
                      setMetadata({ ...metadata, license: e.target.value as AudioLicense })
                    }
                  >
                    {AUDIO_LICENSES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Attribution / permission notes
                <textarea
                  maxLength={2000}
                  value={metadata.notes}
                  onChange={(e) => setMetadata({ ...metadata, notes: e.target.value })}
                />
              </label>
              <label className="local-audio-check">
                <input
                  type="checkbox"
                  checked={metadata.permission}
                  required
                  onChange={(e) => setMetadata({ ...metadata, permission: e.target.checked })}
                />{" "}
                I have permission to use this file.
              </label>
              <Button type="submit" disabled={busy || !playlist || !metadata.permission}>
                Add audio to {playlist?.name || "playlist"}
              </Button>
            </>
          )}
        </form>
        <p className="text-sm text-muted">
          Imported files play locally without a network connection. This library is shared by DMs
          using this device, stays out of campaign backups and account sync, and may be removed if
          you clear browser storage. Keep your original files.
        </p>
        <small>
          {(
            library.tracks.filter((x) => !x.bundled).reduce((sum, x) => sum + x.bytes, 0) /
            1024 /
            1024
          ).toFixed(1)}{" "}
          MB of 200 MB local import limit
        </small>
      </section>
      <section className="local-audio-card" aria-label="Scene playlists">
        <h2>Scene playlists</h2>
        <p>
          Switch to an assigned playlist when you enter its menu scene. Starts only after you press
          Play; pausing or stopping suspends switching.
        </p>
        <label className="local-audio-check">
          <input
            type="checkbox"
            checked={library.followScenes}
            disabled={busy}
            onChange={(e) => {
              const checked = e.target.checked;
              void change((lib) => {
                lib.followScenes = checked;
              });
            }}
          />{" "}
          Follow assigned scene playlists
        </label>
        <div className="local-audio-fields">
          {Object.entries(AUDIO_SCENES).map(([scene, label]) => (
            <label key={scene}>
              {label}
              <select
                aria-label={label}
                value={library.assignments[scene as AudioScene] || ""}
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value;
                  void change((lib) => {
                    if (value) lib.assignments[scene as AudioScene] = value;
                    else delete lib.assignments[scene as AudioScene];
                  });
                }}
              >
                <option value="">Keep current playlist</option>
                {library.playlists.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>
      {!!library.tracks.some((x) => !x.bundled) && (
        <section className="local-audio-card" aria-label="Imported audio files">
          <h2>Imported files</h2>
          <p>Deleting a file removes it from every local playlist.</p>
          {library.tracks
            .filter((x) => !x.bundled)
            .map((track) => (
              <div key={track.id} className="local-audio-file">
                <strong>{track.title}</strong>
                <TrackCredits track={track} />
                {deleteId === track.id ? (
                  <div>
                    <p>Delete {track.title} from this device?</p>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await localAudioLibrary.save((lib, files) => {
                            lib.tracks = lib.tracks.filter((x) => x.id !== track.id);
                            for (const item of lib.playlists)
                              item.tracks = item.tracks.filter((x) => x !== track.id);
                            files.delete(track.id);
                          });
                          setDeleteId("");
                        })
                      }
                    >
                      Confirm delete file
                    </Button>
                    <Button variant="secondary" onClick={() => setDeleteId("")}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => setDeleteId(track.id)}>
                    Delete local file
                  </Button>
                )}
              </div>
            ))}
        </section>
      )}
      <p role="status">{busy ? "Saving audio library…" : message || saved.error}</p>
    </div>
  );
}
