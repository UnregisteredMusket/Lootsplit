import { useEffect, useRef } from "react";
import { Grid3X3, Move } from "lucide-react";

export type GridModeChoice = "snap" | "align";

/** The before → after sketch on each option card (mockup grid-snap, frame 2). */
function Sketch({ snap }: { snap: boolean }) {
  const grid = (ox: number, shift: number) => (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={`c${i}`} x1={ox + shift + i * 32} y1={shift} x2={ox + shift + i * 32} y2={96 + shift} />
      ))}
      {[0, 1, 2, 3].map((j) => (
        <line key={`r${j}`} x1={ox + shift} y1={shift + j * 32} x2={ox + shift + 128} y2={shift + j * 32} />
      ))}
    </>
  );
  const disc = (x: number, y: number, ok = false) => (
    <circle cx={x} cy={y} r="12" className={ok ? "ok" : undefined} />
  );
  return (
    <svg className="grid-mode-sketch" viewBox="0 0 300 108" aria-hidden="true">
      {grid(0, 0)}
      {disc(27, 25)}
      {disc(87, 60)}
      <path className="arrow" d="M136 48h18m-6-6 6 6-6 6" />
      {snap ? (
        <>
          {grid(162, 0)}
          {disc(178, 16, true)}
          {disc(242, 48, true)}
        </>
      ) : (
        <>
          {grid(162, 9)}
          {disc(189, 25, true)}
          {disc(249, 60, true)}
        </>
      )}
    </svg>
  );
}

/**
 * "Turn on grid mode" (owner, 2026-10-29; mockup grid-snap frame 2): tokens between squares are
 * snapped to the nearest squares in one undoable action (recommended), or the grid shifts under
 * them, or grid mode is just turned on. Turning grid mode off never moves a token.
 */
export function GridModeDialog({
  count,
  choice,
  setChoice,
  busy,
  error,
  onConfirm,
  onJustTurnOn,
  onCancel,
}: {
  count: number;
  choice: GridModeChoice;
  setChoice: (choice: GridModeChoice) => void;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onJustTurnOn: () => void;
  onCancel: () => void;
}) {
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const tokens = `${count} ${count === 1 ? "token" : "tokens"}`;
  const option = (value: GridModeChoice) => ({
    role: "radio" as const,
    "aria-checked": choice === value,
    tabIndex: choice === value ? 0 : -1,
    className: `grid-mode-option${choice === value ? " chosen" : ""}`,
    onClick: () => setChoice(value),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const next = value === "snap" ? "align" : "snap";
        setChoice(next);
        (event.currentTarget.parentElement?.querySelector(`[data-choice="${next}"]`) as HTMLElement | null)?.focus();
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setChoice(value);
      }
    },
  });
  return (
    <div className="grid-mode-scrim">
      <section
        className="grid-mode-dialog map-glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grid-mode-title"
        aria-describedby="grid-mode-intro"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id="grid-mode-title">Turn on grid mode</h2>
        <p id="grid-mode-intro">
          {tokens} {count === 1 ? "sits" : "sit"} between squares. Choose how they line up with the
          grid. Either choice can be undone, and turning grid mode off again never moves a token.
        </p>
        <div className="grid-mode-options" role="radiogroup" aria-label="How tokens line up">
          <div {...option("snap")} ref={first} data-choice="snap">
            <h3>
              <Grid3X3 size={16} aria-hidden="true" /> Snap tokens to the nearest squares{" "}
              <span className="grid-mode-pill">Recommended</span>
            </h3>
            <Sketch snap />
            <p>
              Keeps your calibrated grid. Each token moves at most half a square, Large and Huge
              tokens included. One action for the whole map, with Undo.
            </p>
          </div>
          <div {...option("align")} data-choice="align">
            <h3>
              <Move size={16} aria-hidden="true" /> Align the grid under the tokens
            </h3>
            <Sketch snap={false} />
            <p>
              Tokens stay exactly where they are. The grid shifts so most of them sit inside
              squares. This may stop the grid matching lines printed on the map art.
            </p>
          </div>
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="grid-mode-actions">
          <button type="button" className="grid-mode-link" disabled={busy} onClick={onJustTurnOn}>
            Just turn it on: leave tokens as they are
          </button>
          <span>
            <button type="button" className="grid-mode-cancel" onClick={onCancel}>
              Cancel
            </button>{" "}
            <button type="button" className="grid-mode-confirm" disabled={busy} onClick={onConfirm}>
              {choice === "snap" ? `Snap ${tokens}` : "Align the grid"}
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}

