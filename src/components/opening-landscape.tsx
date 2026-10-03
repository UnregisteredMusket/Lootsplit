/** Original pixel landscape, drawn as crisp vector pixels for every display size. */
export function OpeningLandscape() {
  return (
    <span className="opening-landscape" aria-hidden="true">
      <svg
        className="opening-sky"
        viewBox="0 0 256 256"
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
      >
        <path fill="#b9c6bd" d="M0 0h256v256H0z" />
        <path fill="#ced3b8" d="M0 45h256v55H0z" />
        <path fill="#e1d8ad" d="M0 100h256v85H0z" />
        <path fill="#ead9a0" d="M183 27h24v4h5v24h-5v5h-24v-5h-5V31h5z" />
        <path fill="#f5e8ba" d="M186 30h18v3h5v17h-5v5h-18v-5h-5V34h5z" />
      </svg>
      {(["clouds", "hills", "forest", "road"] as const).map((layer) => (
        <span key={layer} className={`opening-pan opening-pan-${layer}`}>
          {[0, 1].map((copy) => (
            <svg
              key={copy}
              viewBox="0 0 256 256"
              preserveAspectRatio="none"
              shapeRendering="crispEdges"
            >
              {layer === "clouds" && (
                <g fill="#f1ead2" opacity=".7">
                  <path d="M12 41h11v-4h19v4h13v5h12v5H7v-5h5zM118 67h14v-5h20v5h15v5h15v5h-72v-5h8zM212 20h11v-4h19v4h14v9h-51v-5h7z" />
                  <path fill="#d6d8c6" d="M7 51h60v3H7zM110 77h72v3h-72z" />
                </g>
              )}
              {layer === "hills" && (
                <>
                  <path
                    fill="#839c97"
                    d="M0 139v-9h13v-12h14v-12h14V92h12V81h9v11h9v12h12v12h15v12h17v-14h15v-13h12V85h11V74h9v12h11v13h13v13h16v14h20v-13h14v-9h20v152H0z"
                  />
                  <path
                    fill="#a7b7a9"
                    d="M41 92h12V81h9v11h9v12h-9v-5h-9v8H41zM142 85h11V74h9v12h11v13h-13v-9h-8v8h-10z"
                  />
                  <path
                    fill="#69877c"
                    d="M0 153h19v-12h19v-9h20v9h16v10h24v-8h21v-9h22v9h19v8h24v-13h17v-8h25v10h30v116H0z"
                  />
                  <g fill="#60786e">
                    <path d="M92 139v-37h4v-7h4v7h5v37zM105 139v-22h26v22zM130 139v-42h4v-8h4v8h5v42zM112 117V99h5V89h5v10h4v18z" />
                    <path fill="#b2b39a" d="M95 106h3v29h-3zM133 101h3v33h-3zM109 121h20v3h-20z" />
                    <path fill="#344e50" d="M115 128h7v11h-7zM115 103h3v5h-3zM134 106h3v5h-3z" />
                    <path fill="#95694f" d="M119 87v-9h12v5h-9v4z" />
                  </g>
                </>
              )}
              {layer === "forest" && (
                <>
                  <path fill="#4e705b" d="M0 170h256v86H0z" />
                  {[4, 34, 70, 160, 202, 238].map((x, i) => (
                    <g key={x} transform={`translate(${x} ${i % 2 ? 12 : 0})`}>
                      <path fill="#594d39" d="M0 117h5v72H0z" />
                      <path
                        fill="#36594b"
                        d="M0 105h5v9h6v11h7v12h6v10h-9v-6h-5v9h12v10h-14v9h-25v-9h-9v-9h9v-12h-8v-8h10v-11h8v-9h5z"
                      />
                      <path
                        fill="#70916c"
                        d="M0 109h4v12h-6v12h-7v10h-7v-8h7v-12h5v-9h4zM-13 150h10v-9h6v15h-16z"
                      />
                      <path fill="#446d51" d="M5 126h5v11h6v7H5zM4 151h10v8H4z" />
                    </g>
                  ))}
                  <path
                    fill="#85915a"
                    d="M0 181h17v-4h11v4h30v-3h20v3h31v-5h15v5h34v-3h26v3h35v-4h14v4h23v22H0z"
                  />
                </>
              )}
              {layer === "road" && (
                <>
                  <path fill="#b79a66" d="M0 192h256v64H0z" />
                  <path fill="#d1b47b" d="M0 198h256v31H0z" />
                  <path fill="#ddc38c" d="M0 206h256v10H0z" />
                  <path fill="#8c794e" d="M0 238h256v18H0z" />
                  <path
                    fill="#617344"
                    d="M0 246h18v-4h12v4h34v-6h10v6h33v-3h13v3h40v-5h14v5h35v-4h12v4h35v10H0z"
                  />
                  <path
                    fill="#9e8457"
                    d="M12 224h13v2H12zM51 202h8v2h-8zM83 230h19v2H83zM134 220h12v2h-12zM187 201h15v2h-15zM224 232h17v2h-17z"
                  />
                  <path
                    fill="#ead29a"
                    d="M27 211h16v2H27zM100 204h18v2h-18zM166 227h10v2h-10zM218 214h13v2h-13z"
                  />
                </>
              )}
            </svg>
          ))}
        </span>
      ))}
    </span>
  );
}
