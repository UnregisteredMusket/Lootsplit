import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { APP_VERSION } from "@/lib/quire/version";
import { API_ORIGIN } from "@/lib/mobile/origin";
import {
  describeClient,
  parseReleaseIdentity,
  type ReleaseIdentity,
} from "@/lib/website/client-presentation";
import release from "@/lib/website/release.json";
import "./release-presentation.css";

export function AboutLootsplit() {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<ReturnType<typeof describeClient> | null>(null);
  const [identity, setIdentity] = useState<ReleaseIdentity | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const controller = new AbortController();
    const isNative = Capacitor.isNativePlatform();
    const platform = Capacitor.getPlatform();
    setClient(describeClient({ isNative, platform, declaredVersion: APP_VERSION }));
    if (isNative) {
      void import("@capacitor/app")
        .then(async ({ App }) => {
          const info = await App.getInfo();
          if (alive)
            setClient(
              describeClient({
                isNative,
                platform,
                declaredVersion: APP_VERSION,
                installedVersion: info.version,
              }),
            );
        })
        .catch(() => {
          // The declared label remains visible; do not invent an installed version.
        });
    }
    setFailed(false);
    setIdentity(null);
    // This asset is produced by the immutable release packager, not the dev server.
    if (import.meta.env.DEV)
      return () => {
        alive = false;
        controller.abort();
      };
    const origin = import.meta.env.VITE_MOBILE === "true" ? API_ORIGIN : "";
    void fetch(`${origin}/assets/release-identity.json`, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error("Release information unavailable");
        const next = parseReleaseIdentity(await response.json());
        if (!next) throw Error("Release information unavailable");
        if (alive) setIdentity(next);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [open, attempt]);

  return (
    <section className="ls-wrap ls-about">
      <details className="ls-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>About this app & releases</summary>
        <div>
          <dl>
            <div>
              <dt>Your client</dt>
              <dd>
                {client
                  ? `${client.label} · ${client.versionLabel} ${client.version}`
                  : "Checking client…"}
              </dd>
            </div>
            <div>
              <dt>Hosted web & backend release</dt>
              <dd>
                {import.meta.env.DEV ? (
                  "Development preview; hosted release identity is not available here."
                ) : identity ? (
                  <>
                    <a
                      href={`https://github.com/UnregisteredMusket/Lootsplit/commit/${identity.commit}`}
                    >
                      <code>{identity.commit}</code>
                    </a>
                    {identity.runId && (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={`https://github.com/UnregisteredMusket/Lootsplit/actions/runs/${identity.runId}`}
                        >
                          Build verification
                        </a>
                      </>
                    )}
                  </>
                ) : failed ? (
                  <>
                    Release identity unavailable.{" "}
                    <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                      Retry
                    </button>
                  </>
                ) : (
                  "Checking hosted release…"
                )}
              </dd>
            </div>
            <div>
              <dt>Published Android download</dt>
              <dd>
                Version {release.version} · version code {release.versionCode} · published{" "}
                {release.date}
              </dd>
            </div>
          </dl>
          <p>
            Android browsers use the website. The installed Android app has its own bundled client;
            web and backend updates do not replace that client. A client release label does not
            establish matching features or a backend compatibility version.
          </p>
          <p>
            Owned DM Local play, Live, online Turn-based play and permitted between-session viewing
            remain available. Shared sessions use the hosted service and its current permissions.
            Keep exported backups outside application storage.
          </p>
          <p>
            <Link to="/updates" hash="web-backend">
              Web & backend history
            </Link>{" "}
            ·{" "}
            <Link to="/updates" hash="android-releases">
              Android history
            </Link>{" "}
            · <Link to="/downloads">Downloads & file verification</Link>
            {client?.kind === "android-native" && (
              <>
                {" "}
                · <a href={`${API_ORIGIN}/welcome`}>Open the website</a>
              </>
            )}
          </p>
        </div>
      </details>
    </section>
  );
}
