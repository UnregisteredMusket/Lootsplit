import { AppLink } from "@/components/app-link";
import { getServerCloudTable } from "@/lib/quire/cloud-client";
import { useSyncExternalStore } from "react";
import { getCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { useEffect, useState } from "react";
import { Link, createFileRoute, useRouterState } from "@tanstack/react-router";
import { CloudTable } from "@/components/cloud-table";
import { Notices } from "@/components/notices";
import { Shell } from "@/components/shell";
import { ManualChat } from "@/components/manual-chat";
import { useChatUnread } from "@/lib/quire/use-chat-unread";
import { ShareChat } from "@/components/share-chat";
import { TableDesk, TableShare } from "@/components/table-share";
import { SyncStatus } from "@/components/sync-status";
import { Fold } from "@/components/ui";
import { RollLog } from "@/components/characters/workspace";
import { useSeat } from "@/lib/quire/seat";

export const Route = createFileRoute("/share")({ component: SharePage });
function SharePage() {
  const [openChat, setOpenChat] = useState(false);
  const [tab, setTab] = useState("room");
  const locationSearch = useRouterState({ select: (s) => s.location.searchStr });
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    const chat = !params.has("join") && params.get("chat") === "1";
    setOpenChat(chat);
    if (params.has("join")) setTab("room");
    else if (chat) setTab("chat");
    else {
      const next = new URLSearchParams(locationSearch).get("tab");
      setTab(next && ["room", "chat", "rolls", "notifications"].includes(next) ? next : "room");
    }
  }, [locationSearch]);
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const seat = useSeat();
  const { count } = useChatUnread();
  return (
    <Shell width="prose">
      <div className="multiplayer-heading">
        <p className="eyebrow">Your party, together</p>
        <h1>Campaign</h1>
        <p className="text-sm text-muted">Multiplayer · your party, messages and rolls</p>
      </div>
      <div className="mode-switch mb-5" role="tablist" aria-label="Multiplayer sections">
        {[
          ["room", "Room"],
          ["chat", count ? `Chat · ${count}` : "Chat"],
          ["rolls", "Rolls"],
          ["notifications", "Alerts"],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            aria-pressed={tab === key}
            onClick={() => setTab(key!)}
          >
            {label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "room"}>
        <CloudTable />
      </div>
      <div hidden={tab !== "chat"}>
        <Fold
          key={String(openChat)}
          defaultOpen={true}
          title={count ? `Messages · ${count} unread` : "Messages"}
          hint="Party chat and private conversations."
        >
          <ShareChat />
        </Fold>
      </div>
      {tab === "rolls" && (
        <div className="character-play campaign-rolls">
          {room.joined ? (
            <RollLog code={room.code} />
          ) : (
            <p className="sheet-card">
              Join an online campaign to see shared rolls.{" "}
              <AppLink href="/characters#dice">Your private dice and roll history →</AppLink>
            </p>
          )}
        </div>
      )}
      <div hidden={tab !== "notifications"}>
        <Fold defaultOpen title="Notifications" hint="Turn reminders, messages, and room changes.">
          <Notices />
        </Fold>
      </div>
      <div className="campaign-support">
        <Fold
          anchorId="connection-recovery"
          title="Connection & recovery"
          hint="Pending changes, retry, and recovery files."
        >
          <SyncStatus />
          <p className="text-sm text-muted">
            Shared changes are saved when the server accepts them. Offline changes stay pending
            until you reconnect.
          </p>
        </Fold>
        <Link to="/settings" className="quick-action mt-4">
          Device backups — view, export & restore →
        </Link>
        <Fold
          title="Manual sharing & files"
          hint="An alternative for playing without an online room."
        >
          <p className="mb-4 text-sm text-muted">
            Online rooms sync automatically. Use these tools for exchanging campaign files in Local
            Mode.
          </p>
          {seat.role === "dm" ? <TableShare /> : null}
          {!room.joined ? (
            <Fold title="Offline messages">
              <ManualChat />
            </Fold>
          ) : null}
          <TableDesk />
        </Fold>
      </div>
    </Shell>
  );
}
