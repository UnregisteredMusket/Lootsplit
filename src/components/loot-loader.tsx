import { useEffect, useRef } from "react";
import "./loot-loader.css";

/** Original 16-bit-style pixel sprite: layered cloth, leather, metal and skin shading. */
export function LootLoader() {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = track.current;
    if (!root) return;
    const carrier = root.querySelector<HTMLElement>(".loot-loader-traveler")!;
    const rogue = root.querySelector<HTMLElement>(".loot-loader-rogue")!;
    const coins = [...root.querySelectorAll<SVGElement>(".loot-ground-coin")];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const start = performance.now();
    // Ten heavy pulls followed by time for the rogue to collect the last coins
    // and leave the frame. Every participant shares the same 15-second clock.
    const progress = (time: number) => {
      const step = Math.min(10, Math.max(0, time));
      const whole = Math.floor(step);
      return (whole + Math.min(1, Math.max(0, (step - whole - 0.6) / 0.3))) / 10;
    };
    const draw = (now: number) => {
      const time = ((now - start) % 15000) / 1000;
      const width = root.clientWidth;
      const distance = width + 400;
      const x = -256 + progress(time) * distance;
      const thiefX = -256 + progress(time - 2) * distance;
      carrier.style.transform = `translateX(${reduced.matches ? width * 0.5 - 80 : x}px)`;
      rogue.style.transform = `translateX(${reduced.matches ? width * 0.5 - 190 : thiefX}px)`;
      rogue.classList.toggle(
        "is-collecting",
        time > 2 && ((time - 2) % 1 > 0.6 || (time - 2) % 1 < 0.25),
      );
      coins.forEach((coin, index) => {
        const step = Math.floor(index / 3);
        const offset = index % 3;
        const drop = step + 0.68 + offset * 0.04;
        const age = time - drop;
        const coinX = -256 + progress(drop) * distance + 65 - offset * 6;
        const caught = thiefX + 105 >= coinX;
        coin.style.opacity = !reduced.matches && age >= 0 && !caught ? "1" : "0";
        const fall = Math.min(1, Math.max(0, age / 0.35));
        coin.style.transform = `translate(${coinX}px, ${116 + 12 * fall - Math.sin(fall * Math.PI) * 6}px)`;
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div ref={track} className="loot-loader-track" aria-hidden="true">
      <div className="loot-loader-traveler">
        <svg viewBox="0 0 128 72" fill="none" shapeRendering="crispEdges" focusable="false">
          <path fill="#050c14" opacity=".45" d="M9 65h45v3H9zM72 65h42v3H72z" />
          <g className="loot-loader-dust" fill="#9b8664">
            <path d="M2 61h3v2H2zM6 65h2v2H6zM1 68h2v1H1zM10 63h2v1h-2z" />
          </g>
          <g className="loot-loader-bag">
            <path fill="#292322" d="M27 25h17v5h6v6h6v8h3v15h-4v6H14v-3H9V45h3v-8h7v-6h8z" />
            <path fill="#715032" d="M27 30h16v4h6v6h5v6h2v12h-5v5H16v-4h-4V46h3v-7h7v-5h5z" />
            <path fill="#aa7743" d="M26 35h16v4h6v7h4v12h-5v3H19v-4h-4V46h5v-7h6z" />
            <path fill="#c79a58" d="M26 38h10v3H24v5h-4v10h-3V45h5v-5h4zM24 58h18v2H24z" />
            <path fill="#deb976" d="M25 40h4v2h-4zM21 45h2v6h-2zM26 58h9v1h-9z" />
            <path fill="#825932" d="M42 38h3v7h4v12h-5v3h-4v-3h3V45h-1zM27 33h13v3H27z" />
            <path fill="#d9b87e" d="M26 31h17v2H26zM29 28h12v2H29z" />
            <path fill="#a47733" d="M24 25h8v5h-8zM32 21h10v8H32zM42 25h7v5h-7z" />
            <path fill="#ecc86a" d="M25 24h7v4h-7zM33 21h8v5h-8zM42 24h6v4h-6z" />
            <path fill="#fff0ad" d="M26 24h5v1h-5zM34 21h5v1h-5zM43 24h3v1h-3z" />
            <path fill="#735034" d="M31 44h9v2h-9zM29 46h2v9h-2zM39 46h2v9h-2zM31 55h8v2h-8z" />
            <path fill="#edc879" d="M32 45h6v2h-6zM34 43h2v13h-2zM31 49h7v2h-7zM32 53h6v2h-6z" />
            <path fill="#795734" d="M18 55h2v2h-2zM22 57h2v2h-2zM47 52h2v2h-2z" />
          </g>
          {/* The fixed rope stays taut while the upper body strains against it. */}
          <path fill="#72563a" d="M43 31h11v-2h11v-2h12v-2h4v3h-4v2H65v2H54v2H43z" />
          <path fill="#e1c18a" d="M43 31h11v-2h11v-2h12v-2h3v1h-3v2H65v2H54v2H43z" />
          <g className="loot-loader-body">
            {/* Forward-leaning hood and cloak. */}
            <path fill="#142031" d="M91 8h16v3h6v5h4v15h-6v5h-8v8h-8v6H71v-7h4V30h5v-9h5v-8h6z" />
            <path fill="#304c60" d="M92 10h14v3h6v5h-9v7h-7v7h-7v9h-6v7H74v-5h4V31h5v-9h5v-8h4z" />
            <path fill="#517b88" d="M92 12h12v2H93v4h-4v7h-4v9h-4v8h-4V31h5v-9h4v-8h6z" />
            <path fill="#81a7ad" d="M93 12h10v1H93zM89 18h2v5h-2zM85 25h2v6h-2z" />
            <path fill="#21364b" d="M92 29h7v10h-7v9H80v-5h5v-8h7zM78 38h3v7h-3z" />
            {/* Face, brow, nose, jaw and stubble. */}
            <path fill="#90634d" d="M102 17h9v4h5v7h-7v5h-9V23h2z" />
            <path fill="#d9a477" d="M103 18h7v4h6v4h-8v4h-6v-8h1z" />
            <path fill="#f4c79a" d="M104 18h5v3h-5zM110 22h5v2h-5zM103 25h4v2h-4z" />
            <path fill="#563e39" d="M107 28h3v3h-7v-2h4zM108 20h4v1h-4z" />
            <path fill="#151e2a" d="M110 21h2v2h-2z" />
            {/* Both hands grip the rope behind him. */}
            <path fill="#1c3044" d="M91 27h7v5h-5v4H81v-3h-5v-7h7v3h8z" />
            <path fill="#547985" d="M91 28h5v3h-5v2H82v-3h9z" />
            <path fill="#e1b184" d="M76 25h5v7h-5zM81 28h5v5h-5z" />
            <path fill="#f7d2a3" d="M77 25h3v2h-3zM82 28h3v2h-3z" />
            <path fill="#ad7958" d="M77 30h3v1h-3zM82 31h3v1h-3z" />
            {/* Belt, buckle, side pouch and sheathed sword. */}
            <path fill="#6e4a33" d="M77 44h21v5H77z" />
            <path fill="#ac8150" d="M78 44h19v2H78z" />
            <path fill="#ecd18b" d="M87 44h6v5h-6z" />
            <path fill="#543e30" d="M89 45h2v3h-2zM95 39h7v10h-7z" />
            <path fill="#b98b57" d="M96 40h5v3h-5z" />
            <path fill="#303242" d="M102 38h3v20h-3z" />
            <path fill="#b5bdba" d="M103 41h1v15h-1z" />
            <path fill="#d1af63" d="M100 38h7v2h-7zM102 34h3v4h-3zM102 56h3v3h-3z" />
          </g>
          <g className="loot-loader-step-a">
            <path
              fill="#152435"
              d="M78 49h11v7h-5v4h-5v4H69v-5h6v-5h3zM90 49h9v7h5v4h5v4h-9v-4h-5v-4h-5z"
            />
            <path fill="#3c5566" d="M79 50h6v5h-5v4h-5v-2h3v-4h1zM92 50h5v6h4v3h-3v-2h-3v-3h-3z" />
            <path fill="#765139" d="M71 59h10v4h-3v3H65v-3h6zM100 59h8v4h6v3h-15v-3h1z" />
            <path
              fill="#b28756"
              d="M72 59h8v2h-8zM101 59h6v2h-6zM66 64h10v1H66zM101 64h11v1h-11z"
            />
          </g>
          <g className="loot-loader-step-b">
            <path fill="#152435" d="M78 49h10v7h5v7H82v-5h-4zM91 49h9v6h-6v5h-5v4H78v-4h8v-6h5z" />
            <path fill="#3c5566" d="M80 50h5v6h4v4h-4v-4h-5zM93 50h5v3h-6v6h-4v-3h3v-3h2z" />
            <path fill="#765139" d="M84 60h9v3h7v3H83zM79 60h8v3h-5v3H73v-3h6z" />
            <path fill="#b28756" d="M85 60h7v2h-7zM79 60h6v2h-6zM85 64h12v1H85z" />
          </g>
          <g className="loot-loader-sweat" fill="#a4d5db">
            <path d="M117 13h2v4h-2zM119 17h2v3h-2z" />
          </g>
        </svg>
      </div>
      <svg className="loot-coins" width="100%" height="144" fill="none" shapeRendering="crispEdges">
        {Array.from({ length: 30 }, (_, index) => (
          <g key={index} className="loot-ground-coin">
            <path fill="#9c6629" d="M0 2h8v5H0z" />
            <path fill="#edc566" d="M1 0h6v5H1z" />
            <path fill="#fff0ad" d="M2 0h4v2H2z" />
          </g>
        ))}
      </svg>
      <div className="loot-loader-rogue">
        <svg viewBox="50 0 78 72" fill="none" shapeRendering="crispEdges" focusable="false">
          <g className="loot-rogue-body">
            {/* Forward-leaning hood and cloak. */}
            <path fill="#142031" d="M91 8h16v3h6v5h4v15h-6v5h-8v8h-8v6H71v-7h4V30h5v-9h5v-8h6z" />
            <path fill="#403557" d="M92 10h14v3h6v5h-9v7h-7v7h-7v9h-6v7H74v-5h4V31h5v-9h5v-8h4z" />
            <path fill="#76608e" d="M92 12h12v2H93v4h-4v7h-4v9h-4v8h-4V31h5v-9h4v-8h6z" />
            <path fill="#a48cba" d="M93 12h10v1H93zM89 18h2v5h-2zM85 25h2v6h-2z" />
            <path fill="#30243f" d="M92 29h7v10h-7v9H80v-5h5v-8h7zM78 38h3v7h-3z" />
            {/* Face, brow, nose, jaw and stubble. */}
            <path fill="#90634d" d="M102 17h9v4h5v7h-7v5h-9V23h2z" />
            <path fill="#d9a477" d="M103 18h7v4h6v4h-8v4h-6v-8h1z" />
            <path fill="#f4c79a" d="M104 18h5v3h-5zM110 22h5v2h-5zM103 25h4v2h-4z" />
            <path fill="#563e39" d="M107 28h3v3h-7v-2h4zM108 20h4v1h-4z" />
            <path fill="#151e2a" d="M110 21h2v2h-2z" />
            <path fill="#30243f" d="M91 29h7v9h-4v6h-5V33h2z" />
            <path fill="#76608e" d="M92 30h4v7h-4z" />
            <path fill="#d9a477" d="M89 41h5v4h-5z" />
            {/* Belt, buckle, side pouch and sheathed sword. */}
            <path fill="#6e4a33" d="M77 44h21v5H77z" />
            <path fill="#ac8150" d="M78 44h19v2H78z" />
            <path fill="#ecd18b" d="M87 44h6v5h-6z" />
            <path fill="#543e30" d="M89 45h2v3h-2zM95 39h7v10h-7z" />
            <path fill="#b98b57" d="M96 40h5v3h-5z" />
            <path fill="#303242" d="M102 38h3v20h-3z" />
            <path fill="#b5bdba" d="M103 41h1v15h-1z" />
            <path fill="#d1af63" d="M100 38h7v2h-7zM102 34h3v4h-3zM102 56h3v3h-3z" />
          </g>
          <g className="loot-loader-step-a">
            <path
              fill="#152435"
              d="M78 49h11v7h-5v4h-5v4H69v-5h6v-5h3zM90 49h9v7h5v4h5v4h-9v-4h-5v-4h-5z"
            />
            <path fill="#3c5566" d="M79 50h6v5h-5v4h-5v-2h3v-4h1zM92 50h5v6h4v3h-3v-2h-3v-3h-3z" />
            <path fill="#765139" d="M71 59h10v4h-3v3H65v-3h6zM100 59h8v4h6v3h-15v-3h1z" />
            <path
              fill="#b28756"
              d="M72 59h8v2h-8zM101 59h6v2h-6zM66 64h10v1H66zM101 64h11v1h-11z"
            />
          </g>
          <g className="loot-loader-step-b">
            <path fill="#152435" d="M78 49h10v7h5v7H82v-5h-4zM91 49h9v6h-6v5h-5v4H78v-4h8v-6h5z" />
            <path fill="#3c5566" d="M80 50h5v6h4v4h-4v-4h-5zM93 50h5v3h-6v6h-4v-3h3v-3h2z" />
            <path fill="#765139" d="M84 60h9v3h7v3H83zM79 60h8v3h-5v3H73v-3h6z" />
            <path fill="#b28756" d="M85 60h7v2h-7zM79 60h6v2h-6zM85 64h12v1H85z" />
          </g>

          <path className="loot-rogue-mask" fill="#241e34" d="M102 25h13v4h-6v4h-9v-5z" />
          <g className="loot-rogue-hand">
            <path fill="#76608e" d="M99 36h5v16h-5zM101 49h6v11h-6z" />
            <path fill="#f4c79a" d="M102 59h7v4h-7z" />
            <path fill="#edc566" d="M106 61h4v3h-4z" />
          </g>
        </svg>
      </div>
    </div>
  );
}
