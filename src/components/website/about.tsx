import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { APP_VERSION } from "@/lib/quire/version";
import { API_ORIGIN } from "@/lib/mobile/origin";
import { describeClient } from "@/lib/website/client-presentation";
import release from "@/lib/website/release.json";
import { useReleaseIdentity } from "./release-identity";
import "./release-presentation.css";

/**
 * About this app & releases: the client, hosted web/backend and published
 * Android identities. Lives once, in Downloads → Release details and
 * verification; every page's footer links to it.
 */
export function AboutLootsplit() {
  const [client, setClient] = useState<ReturnType<typeof describeClient> | null>(null);
  const { state: hosted, retry } = useReleaseIdentity();

  useEffect(() => {
    let alive = true;
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
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="ls-about">
      <h3 id="about-this-app">About this app & releases</h3>
      <dl className="ls-meta">
        <dt>Your client</dt>
        <dd>
          {client
            ? `${client.label} · ${client.versionLabel} ${client.version}`
            : "Checking client…"}
        </dd>
        <dt>Hosted web & backend release</dt>
        <dd>
          {hosted.status === "development" ? (
            "Development preview; hosted release identity is not available here."
          ) : hosted.status === "ready" ? (
            <>
              <a
                href={`https://github.com/UnregisteredMusket/Lootsplit/commit/${hosted.identity.commit}`}
              >
                <code>{hosted.identity.commit}</code>
              </a>
              {hosted.identity.runId && (
                <>
                  {" "}
                  ·{" "}
                  <a
                    href={`https://github.com/UnregisteredMusket/Lootsplit/actions/runs/${hosted.identity.runId}`}
                  >
                    Build verification
                  </a>
                </>
              )}
            </>
          ) : hosted.status === "failed" ? (
            <>
              Release identity unavailable.{" "}
              <button type="button" onClick={retry}>
                Retry
              </button>
            </>
          ) : (
            "Checking hosted release…"
          )}
        </dd>
        <dt>Published Android download</dt>
        <dd>
          Version {release.version} · version code {release.versionCode} · published{" "}
          {release.date}
        </dd>
      </dl>
      <p>
        Android browsers use the website. The installed Android app has its own bundled client; web
        and backend updates do not replace that client. A client release label does not establish
        matching features or a backend compatibility version.
      </p>
      <p>
        Owned DM Local play, Live, online Turn-based play and permitted between-session viewing
        remain available. Shared sessions use the hosted service and its current permissions. Keep
        exported backups outside application storage.
      </p>
      <p className="ls-about-links">
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
  );
}
