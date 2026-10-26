import { SoundSettings } from "@/components/sound-settings";
import { PlayerPermissions } from "@/components/character-permissions";
import { ReferenceControls } from "@/components/reference-controls";
import { AppLink } from "@/components/app-link";
import { RollModeSetting } from "@/components/roll-mode-setting";
import { FantasyIcon } from "@/components/fantasy-icon";
import { useState } from "react";
import { TestModeSettings } from "@/components/test-mode";
import { ChevronDown, LogIn } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { FANTASY_LOOKS } from "@/lib/quire/theme";
import { usePrefs, useShowDollars } from "@/lib/quire/prefs";
import { Campaigns } from "@/components/campaigns";
import { useRouterState } from "@tanstack/react-router";
import { openShortcutSheet } from "@/components/command-palette";
import { OPEN_WORKSPACE_WINDOWS } from "@/components/split-view";
type Group = {
  name: string;
  icon: string;
  links?: [string, string][];
  content?: React.ReactNode;
};
export function ManagementPanel({
  open,
  onOpenChange,
  dm,
  campaign,
  onRoleChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dm: boolean;
  campaign: string;
  onRoleChange: () => void;
}) {
  const { prefs, setPrefs } = usePrefs(),
    showDollars = useShowDollars(),
    [expanded, setExpanded] = useState("");
  const href = useRouterState({ select: (s) => s.location.href });
  const native = import.meta.env.VITE_MOBILE === "true";
  const tools = (
    <div className="settings-tool-buttons">
      {!native && (
        <button
          type="button"
          className="settings-link"
          onClick={() => {
            onOpenChange(false);
            window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_WINDOWS, { detail: href }));
          }}
        >
          Tabs & windows…<span aria-hidden="true">›</span>
        </button>
      )}
    </div>
  );
  const shortcuts = (
    <button
      type="button"
      className="settings-link"
      onClick={() => {
        onOpenChange(false);
        openShortcutSheet();
      }}
    >
      Keyboard shortcuts<span aria-hidden="true">›</span>
    </button>
  );
  const appearance = (
    <div className="setting-preferences">
      <label>
        Theme
        <select
          aria-label="Theme"
          value={prefs.appearance}
          onChange={(e) => {
            const appearance = e.target.value as "dark" | "light";
            const look = FANTASY_LOOKS[appearance];
            setPrefs({ appearance, accent: look.accent, ground: look.ground });
          }}
        >
          <option value="dark">Dark · Ironbound Dragon</option>
          <option value="light">Light · Adventurer’s Ledger</option>
        </select>
      </label>
      <label>
        PDF reading size
        <select
          aria-label="Reading size"
          value={prefs.readScale}
          onChange={(e) => setPrefs({ readScale: Number(e.target.value) })}
        >
          <option value={0}>Compact</option>
          <option value={1}>Standard</option>
          <option value={2}>Large</option>
          <option value={3}>Extra large</option>
        </select>
      </label>
      <label className="flex gap-3 items-center">
        <input
          type="checkbox"
          checked={showDollars}
          onChange={(e) => setPrefs({ showDollars: e.target.checked })}
        />
        Show dollar estimates
      </label>
      <SoundSettings />
      <p>Motion follows your device’s reduced-motion preference.</p>
    </div>
  );
  const groups: Group[] = dm
    ? [
        {
          name: "Campaign",
          icon: "Campaign",
          links: [
            ["Desk & sessions", "/?view=home#sessions"],
            ["Manage saved campaigns", "/account"],
            ["Local, live & turn-based play", "/share"],
          ],
        },
        {
          name: "Players & permissions",
          content: <><PlayerPermissions /><ReferenceControls /></>,
          icon: "Party",
          links: [
            ["Party & character assignments", "/party"],
            ["Room members & permissions", "/share?tab=room"],
            ["Assigned character sheets", "/characters"],
          ],
        },
        {
          name: "Gameplay",
          icon: "Dice",
          content: <RollModeSetting />,
          links: [
            ["Encounter desk & generator", "/encounters"],
            ["Review character imports", "/features/review"],
            ["Character rolls & manual-roll policy", "/characters#dm-roll-controls"],
            ["Turn management", "/share?tab=room"],
          ],
        },
        {
          name: "Economy",
          icon: "Treasury",
          links: [
            ["Shop schedules", "/features/shops"],
            ["Property management", "/features/properties"],
            ["Currency, price modifiers & shop defaults", "/features/financial"],
            ["Shops & stock", "/market"],
            ["Requests & approvals", "/features/review"],
          ],
        },
        {
          name: "Dashboard",
          icon: "Desk",
          content: (
            <>
              <p>
                The Desk uses swipeable information panels. Previously saved shortcuts remain
                accessible in their settings.
              </p>
              <AppLink
                href="/?view=home&customize=1#saved-shortcuts"
                className="settings-link"
                onClick={() => onOpenChange(false)}
              >
                Saved shortcut settings →
              </AppLink>
            </>
          ),
        },
        {
          name: "Appearance & notifications",
          icon: "Appearance",
          content: <>{appearance}{tools}</>,
          links: [
            ["Custom colors & display preferences", "/settings#appearance"],
            ["Message & turn notifications", "/share?tab=notifications"],
          ],
        },
        {
          name: "Account & backups",
          icon: "save",
          links: [
            ["Profile & security", "/account#account-profile"],
            ["Cloud backups", "/account#account-backups"],
            ["Device backups & restore", "/settings#backups"],
          ],
        },
        {
          name: "Help & administration",
          icon: "Help",
          content: shortcuts,
          links: [
            ["Guides & help", "/help?guide=dm"],
            ["Report a bug", "/account#bug-reports"],
            ["Authorized staff tools", "/account#account-administration"],
            ["Website, downloads & resources", "/welcome"],
          ],
        },
      ]
    : [
        {
          name: "Character",
          icon: "Character",
          links: [
            ["My character sheets & imports", "/characters"],
            ["Assigned character & handouts", "/?view=sheet"],
          ],
        },
        {
          name: "Campaign",
          icon: "Campaign",
          links: [
            ["Join & connection settings", "/share"],
            ["Saved campaign memberships", "/account"],
            ["Campaign overview", "/?view=overview"],
          ],
        },
        {
          name: "Rolls",
          icon: "Dice",
          content: <RollModeSetting />,
          links: [["Dice rolls & history", "/characters#dice"]],
        },
        { name: "Appearance", icon: "Appearance", content: <>{appearance}{tools}</> },
        {
          name: "Notifications",
          icon: "Notifications",
          links: [["Messages & turn alerts", "/share?tab=notifications"]],
        },
        {
          name: "Account & privacy",
          icon: "Privacy",
          links: [["Profile, password, recovery & privacy", "/account"]],
        },
        {
          name: "Backups",
          icon: "save",
          links: [
            ["Device backups & restore", "/settings#backups"],
            ["Private cloud backup library", "/account#account-backups"],
          ],
        },
        {
          name: "Help",
          icon: "Help",
          content: shortcuts,
          links: [
            ["Guides & help", "/help?guide=player"],
            ["Report a bug", "/account#bug-reports"],
            ["Website & downloads", "/welcome"],
          ],
        },
      ];
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Settings & Management"
      returnFocus=".settings-trigger"
    >
      <div className="management-panel">
        <p className="management-scope">
          {campaign} · {dm ? "Dungeon Master" : "Player"}
        </p>
        <p className="text-xs text-muted mb-3">
          {dm
            ? "Campaign controls & personal preferences"
            : "Your character & personal preferences"}
        </p>
        {groups.map((g) => {
          return (
            <section className="management-group" key={g.name}>
              <button
                className="management-category"
                aria-expanded={expanded === g.name}
                onClick={() => setExpanded(expanded === g.name ? "" : g.name)}
              >
                <FantasyIcon ui={g.icon} size={28} />
                <span>{g.name}</span>
                <ChevronDown className={expanded === g.name ? "rotate-180" : ""} />
              </button>
              {expanded === g.name && (
                <div className="management-content">
                  {g.content}
                  {g.links?.map(([label, href]) => (
                    <AppLink
                      key={href + label}
                      href={href}
                      className="settings-link"
                      onClick={() => onOpenChange(false)}
                    >
                      {label}
                      <span aria-hidden="true">›</span>
                    </AppLink>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        <div className="management-footer">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              onRoleChange();
            }}
          >
            <LogIn size={16} />
            Change device role
          </Button>
          <AppLink href="/account" onClick={() => onOpenChange(false)}>
            My account
          </AppLink>
        </div>
        {open && <TestModeSettings inMenu />}
      </div>
    </Modal>
  );
}
export function CampaignPanel({
  open,
  onOpenChange,
  dm,
  campaign,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dm: boolean;
  campaign: string;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Campaigns"
      returnFocus=".campaign-switcher"
    >
      <p className="text-muted mb-3">Current campaign · {campaign}</p>
      {dm ? (
        <Campaigns heading={false} />
      ) : (
        <p>
          Resume another campaign from your saved account memberships, or leave this room before
          joining a different one.
        </p>
      )}
      <AppLink href="/account" className="settings-link">
        Saved account campaigns →
      </AppLink>
      <AppLink href="/share" className="settings-link">
        Room, invitations & connections →
      </AppLink>
    </Modal>
  );
}
