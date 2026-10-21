import { useEffect, useState } from "react";
import { accountRequest } from "@/lib/account/client";
type Announcement = { title: string; message: string };
export function SiteAnnouncement() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  useEffect(() => {
    let alive = true;
    accountRequest<{ announcement: Announcement | null }>("site-announcement")
      .then((result) => {
        if (alive) setAnnouncement(result.announcement);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!announcement) return null;
  return (
    <aside className="ls-announcement" aria-label="Site announcement">
      <div className="ls-wrap">
        <p className="ls-sc">From the owner</p>
        <h2>{announcement.title}</h2>
        <p>{announcement.message}</p>
      </div>
    </aside>
  );
}
