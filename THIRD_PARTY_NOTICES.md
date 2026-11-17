# Third-party notices

## Stockfish.js 19 Lite single-threaded (npm package 19.0.1)

Knightline loads the following engine assets on demand from jsDelivr:

- `https://cdn.jsdelivr.net/npm/stockfish@19.0.1/bin/stockfish-19-lite-single.js`
- `https://cdn.jsdelivr.net/npm/stockfish@19.0.1/bin/stockfish-19-lite-single.wasm`

The engine is Stockfish.js by Nathan Rugg and contributors. Stockfish.js is distributed under the GNU General Public License v3.0 (GPL-3.0).

- Source and release: https://github.com/nmrugg/stockfish.js/tree/v19.0.0
- License text: https://github.com/nmrugg/stockfish.js/blob/v19.0.0/Copying.txt
- Upstream Stockfish: https://github.com/official-stockfish/Stockfish

The JavaScript and WebAssembly engine files are not copied into this repository; the browser fetches the pinned release from jsDelivr when a user starts an analysis.

## chess.js 0.10.3

Knightline loads chess.js 0.10.3 from cdnjs for PGN parsing and legal move playback.

- Project: https://github.com/jhlywa/chess.js
- License: BSD-2-Clause
- CDN: https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js
