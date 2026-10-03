/** Half-pixel accents give the original silhouettes a finer, shaded 32-bit-era finish. */
export function LootSpriteDetail({ rogue = false }: { rogue?: boolean }) {
  return (
    <g>
      <path
        fill={rogue ? "#5f4b76" : "#426775"}
        d="M90 15h3v3h-3zM86 22h3v4h-3zM82 31h3v5h-3zM78 39h3v4h-3zM89 33h3v7h-3zM84 41h3v4h-3z"
      />
      <path
        fill={rogue ? "#c3abd0" : "#afd0ce"}
        d="M94 11h9v.5h-9zM90 17h.5v4H90zM86 25h.5v5H86zM80 35h.5v4H80z"
      />
      <path
        fill={rogue ? "#9278a5" : "#6994a0"}
        d="M95 14h6v.5h-6zM88 23h1v2h-1zM84 30h1v3h-1zM79 42h2v1h-2zM90 37h1v2h-1z"
      />
      <path fill={rogue ? "#241b35" : "#192d40"} d="M94 31h1v7h-1zM87 38h1v6h-1zM82 44h3v.5h-3z" />
      <path fill="#e8b88b" d="M103 20h2v3h-2zM106 24h3v1h-3z" />
      <path fill="#ffe0b5" d="M105 18h3v.5h-3zM111 23h3v.5h-3z" />
      <path fill="#372c2e" d="M108 20h3v.5h-3zM107 27h2v.5h-2z" />
      <path fill="#f5e8c4" d="M110 21h.5v.5h-.5z" />
      <path fill="#d6ac6e" d="M78 45h7v.5h-7zM94 45h3v.5h-3zM97 41h3v.5h-3z" />
      <path fill="#fff0bb" d="M88 44h4v.5h-4zM88 45h.5v2H88zM103 42h.5v10h-.5z" />
      <path fill="#302a2a" d="M96 44h4v.5h-4zM96 46h1v1h-1zM99 46h1v1h-1z" />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} fill={rogue ? "#a48cba" : "#81a7ad"} d={`M${78 + i * 2} 43h.5v.5h-.5z`} />
      ))}
    </g>
  );
}
