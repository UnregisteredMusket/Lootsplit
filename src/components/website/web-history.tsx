import { publishedWebReleases, webReleases } from "@/lib/website/web-releases";

export function WebReleaseHistory() {
  return (
    <section aria-labelledby="web-backend">
      <h2 id="web-backend">Web & backend</h2>
      <p className="ls-copy">
        Published website and server changes have their own history. These notes do not change the
        Android download or promise that an installed APK contains newer client features.
      </p>
      {publishedWebReleases(webReleases).map((entry) => (
        <article className="ls-release" key={entry.id} id={`web-${entry.id}`}>
          <div className="ls-release-meta">
            <span className="ls-tag">PUBLISHED WEB & BACKEND</span>
            <time dateTime={entry.date}>
              {new Date(`${entry.date}T00:00:00Z`).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })}
            </time>
          </div>
          <h3>{entry.title}</h3>
          <p className="ls-copy">{entry.summary}</p>
          <ul>
            {entry.improvements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="ls-small-copy">
            Published source:{" "}
            <a href={`https://github.com/UnregisteredMusket/Lootsplit/commit/${entry.commit}`}>
              <code>{entry.commit.slice(0, 12)}</code>
            </a>
          </p>
          <p className="ls-small-copy">
            {entry.evidence.map((item, index) => (
              <span key={item.url}>
                {index > 0 && " · "}
                <a href={item.url}>{item.label}</a>
              </span>
            ))}
          </p>
        </article>
      ))}
    </section>
  );
}
