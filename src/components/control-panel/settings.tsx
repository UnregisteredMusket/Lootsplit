import { useState } from "react";
import {
  ChevronDown,
  Coins,
  Dices,
  Grid2X2,
  HelpCircle,
  Palette,
  Save,
  Settings,
  Shield,
  Users,
  Map,
  UserRound,
  Bell,
  LogIn,
} from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { luminance, DEFAULT_GROUND } from "@/lib/quire/theme";
import { usePrefs } from "@/lib/quire/prefs";
import { Campaigns } from "@/components/campaigns";
type Group = {
  name: string;
  icon: typeof Settings;
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
    [expanded, setExpanded] = useState("");
  const appearance = (
    <div className="setting-preferences">
      <label>
        Theme
        <select
          aria-label="Theme"
          value={prefs.appearance}
          onChange={(e) => {
            const appearance = e.target.value as "dark" | "light";
            const pale = luminance(prefs.ground) >= 0.55;
            setPrefs({
              appearance,
              ...(appearance === "light" && !pale
                ? { ground: "#f6f1e6" }
                : appearance === "dark" && pale
                  ? { ground: DEFAULT_GROUND }
                  : {}),
            });
          }}
        >
          <option value="dark">Dark ledger</option>
          <option value="light">Light ledger</option>
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
          checked={prefs.showDollars}
          onChange={(e) => setPrefs({ showDollars: e.target.checked })}
        />
        Show dollar estimates
      </label>
      <p>Motion follows your device’s reduced-motion preference.</p>
    </div>
  );
  const groups: Group[] = dm
    ? [
        {
          name: "Campaign",
          icon: Map,
          links: [
            ["Campaign overview & sessions", "/?view=overview"],
            ["Manage saved campaigns", "/account"],
            ["Local, live & turn-based play", "/share"],
          ],
        },
        {
          name: "Players & permissions",
          icon: Users,
          links: [
            ["Party & character assignments", "/party"],
            ["Room members & permissions", "/share"],
            ["Assigned character sheets", "/characters"],
          ],
        },
        {
          name: "Gameplay",
          icon: Dices,
          links: [
            ["Encounter desk & generator", "/encounters"],
            ["Character rolls & manual-roll policy", "/characters#dm-roll-controls"],
            ["Turn management", "/share"],
          ],
        },
        {
          name: "Economy",
          icon: Coins,
          links: [
            ["Currency, price modifiers & shop defaults", "/settings#economy"],
            ["Shops & stock", "/market"],
            ["Requests & approvals", "/?view=overview#review"],
          ],
        },
        {
          name: "Dashboard",
          icon: Grid2X2,
          content: (
            <>
              <p>Choose the label, icon and destination for each of your six shortcut buttons.</p>
              <a href="/?view=home&customize=1" className="settings-link">
                Customize & reorder shortcuts →
              </a>
            </>
          ),
        },
        {
          name: "Appearance & notifications",
          icon: Palette,
          content: appearance,
          links: [
            ["Custom colors & display preferences", "/settings#appearance"],
            ["Message & turn notifications", "/share?tab=notifications"],
          ],
        },
        {
          name: "Account & backups",
          icon: Save,
          links: [
            ["Profile, security & cloud backups", "/account"],
            ["Device backups & restore", "/settings#backups"],
          ],
        },
        {
          name: "Help & administration",
          icon: HelpCircle,
          links: [
            ["Guides & help", "/help"],
            ["Report a bug", "/account#bug-reports"],
            ["Authorized staff tools", "/account"],
            ["Website, downloads & resources", "/welcome"],
          ],
        },
      ]
    : [
        {
          name: "Character",
          icon: UserRound,
          links: [
            ["My character sheets & imports", "/characters"],
            ["Assigned character & handouts", "/?view=sheet"],
          ],
        },
        {
          name: "Campaign",
          icon: Map,
          links: [
            ["Join & connection settings", "/share"],
            ["Saved campaign memberships", "/account"],
            ["Campaign overview", "/?view=overview"],
          ],
        },
        {
          name: "Rolls",
          icon: Dices,
          content: (
            <p>
              Manual results are controlled by the campaign DM. Each roll form shows whether they
              are available.
            </p>
          ),
          links: [["Dice rolls & history", "/characters#dice"]],
        },
        { name: "Appearance", icon: Palette, content: appearance },
        {
          name: "Notifications",
          icon: Bell,
          links: [["Messages & turn alerts", "/share?tab=notifications"]],
        },
        {
          name: "Account & privacy",
          icon: Shield,
          links: [["Profile, password, recovery & privacy", "/account"]],
        },
        {
          name: "Backups",
          icon: Save,
          links: [
            ["Device backups & restore", "/settings#backups"],
            ["Private cloud backup library", "/account"],
          ],
        },
        {
          name: "Help",
          icon: HelpCircle,
          links: [
            ["Guides & help", "/help"],
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
          const Icon = g.icon;
          return (
            <section className="management-group" key={g.name}>
              <button
                className="management-category"
                aria-expanded={expanded === g.name}
                onClick={() => setExpanded(expanded === g.name ? "" : g.name)}
              >
                <Icon aria-hidden="true" />
                <span>{g.name}</span>
                <ChevronDown className={expanded === g.name ? "rotate-180" : ""} />
              </button>
              {expanded === g.name && (
                <div className="management-content">
                  {g.content}
                  {g.links?.map(([label, href]) => (
                    <a
                      key={href + label}
                      href={href}
                      className="settings-link"
                      onClick={() => onOpenChange(false)}
                    >
                      {label}
                      <span aria-hidden="true">›</span>
                    </a>
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
          <a href="/account" onClick={() => onOpenChange(false)}>
            My account
          </a>
        </div>
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
        <Campaigns />
      ) : (
        <p>
          Resume another campaign from your saved account memberships, or leave this room before
          joining a different one.
        </p>
      )}
      <a href="/account" className="settings-link">
        Saved account campaigns →
      </a>
      <a href="/share" className="settings-link">
        Room, invitations & connections →
      </a>
    </Modal>
  );
}
