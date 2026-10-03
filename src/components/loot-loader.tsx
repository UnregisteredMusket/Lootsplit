import "./loot-loader.css";

/** Original pixel artwork, drawn on an integer grid so it stays sharp at every frame. */
export function LootLoader() {
  return (
    <div className="loot-loader-track" aria-hidden="true">
      <div className="loot-loader-traveler">
        <svg viewBox="0 0 80 48" fill="none" shapeRendering="crispEdges" focusable="false">
          <g className="loot-loader-dust" fill="#8b795a">
            <path d="M2 41h3v2H2zM7 44h2v2H7zM1 46h2v1H1z" />
          </g>
          <g className="loot-loader-bag">
            <path fill="#33291e" d="M17 21h12v4h4v4h4v10h-3v4H13v-3H9V29h4v-5h4z" />
            <path fill="#9d6b36" d="M18 24h10v3h4v4h3v7h-4v3H15v-3h-4v-8h4v-3h3z" />
            <path fill="#c99b56" d="M18 27h8v3h-8v8h-4v-7h4zM20 38h10v2H20z" />
            <path fill="#73502e" d="M28 29h4v9h-4zM19 23h10v3H19z" />
            <path fill="#f2cf76" d="M18 20h5v3h-5zM24 18h5v4h-5zM28 21h4v3h-4z" />
            <path fill="#fff0b4" d="M19 20h2v1h-2zM25 18h2v1h-2z" />
            <path fill="#e3b566" d="M20 31h6v2h-6zM22 29h2v8h-2zM20 35h6v2h-6z" />
          </g>
          <g className="loot-loader-body">
            {/* Taut rope runs back from the adventurer's hand to the sack. */}
            <path fill="#d1ac70" d="M29 24h8v-2h7v-2h8v2h-7v2h-7v2h-9z" />
            <path fill="#172536" d="M53 7h11v3h4v12h-5v4h-6v6H43v-6h3v-9h3v-6h4z" />
            <path fill="#496b76" d="M54 9h9v3h-8v5h-4v9h-5v-8h4v-6h4z" />
            <path fill="#283f52" d="M53 18h9v7h-5v8H44v-6h5v-5h4z" />
            <path fill="#71939a" d="M55 10h7v2h-7zM51 17h3v7h-3z" />
            <path fill="#d7a573" d="M59 13h6v3h3v3h-5v3h-5v-5h1zM48 21h5v4h-5z" />
            <path fill="#f3c996" d="M61 13h4v3h-4zM49 21h3v2h-3z" />
            <path fill="#182333" d="M64 14h2v2h-2z" />
            <path fill="#b69454" d="M47 28h12v3H47z" />
            <path fill="#f4d38a" d="M53 28h3v3h-3z" />
            <path fill="#7c4f35" d="M58 23h4v10h-4z" />
            <path fill="#d7c8a4" d="M60 29h2v9h-2z" />
          </g>
          <g className="loot-loader-step-a">
            <path fill="#263749" d="M46 32h7v5h-4v4h-5v-5h2zM54 32h5v4h4v4h-5v-3h-4z" />
            <path fill="#956841" d="M43 40h7v4H40v-2h3zM59 39h6v3h3v2H58v-3h1z" />
            <path fill="#c0965d" d="M43 40h5v1h-5zM61 39h3v1h-3z" />
          </g>
          <g className="loot-loader-step-b">
            <path fill="#263749" d="M47 32h6v7h3v3h-6v-4h-3zM54 32h5v4h-4v4h-5v-4h4z" />
            <path fill="#956841" d="M50 40h7v2h3v2H50zM47 39h5v4H42v-2h5z" />
            <path fill="#c0965d" d="M51 40h4v1h-4zM47 39h4v1h-4z" />
          </g>
        </svg>
      </div>
    </div>
  );
}
