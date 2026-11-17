# Knightline

Knightline is an independent, browser-based workspace for exploring public Chess.com player data and replaying archived games.

## Features

- Look up a public Chess.com username.
- View the public profile, title, country, follower count, and online status when available.
- View Bullet, Blitz, Rapid, and Daily rating snapshots, records, and peak ratings.
- Browse the player's available monthly game archives.
- Replay published PGNs on an independent chessboard with previous/next/start/end controls.
- Run local Stockfish 19 Lite analysis on a completed game, including an evaluation bar, clickable evaluation graph, suggested-move arrows, alternate lines, tactical continuations, and move classifications.
- Display Chess.com's published game accuracy and recorded in-game ratings when the archive response includes them.
- Download the selected PGN and open the original game on Chess.com.
- Remembers the last searched username in the current browser (no passwords or Chess.com credentials are collected).

## Run locally

Open `index.html` from a local web server, or publish the repository with GitHub Pages. The app uses:

- Chess.com Published-Data API: `https://api.chess.com/pub/`
- chess.js 0.10.3 from cdnjs for PGN parsing and legal move playback.
- Stockfish.js 19 Lite single-threaded WebAssembly engine from the pinned npm package 19.0.1, loaded only when the user starts a review.
- Google Fonts for typography.

No build step, API key, database, or server-side secret is required. The first analysis downloads the Stockfish JavaScript and approximately 1.8 MB WebAssembly engine from jsDelivr.

## Publish with GitHub Pages

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then save.
4. GitHub Pages will publish the site at `https://idkeman.github.io/Chess-interaction/`.

 
## Import Chess.com's original Computer Analysis

The monthly Published-Data API archive provides a standard PGN and, when previously calculated, the game's two accuracy values. It does not provide Chess.com's original private move-review annotations, graph points, or coach commentary through the public archive.

To import a PGN with original review data:

1. Open the finished game on Chess.com.
2. Open its Analysis view and run or open the review.
3. Use the Share option at the bottom of the analysis panel.
4. Choose **PGN**, then select **Computer Analysis** in the export options.
5. Download the PGN, then choose it under **Import Chess.com's original analysis** in Knightline (or paste its contents).

Chess.com documents this export option in its [PGN export instructions](https://support.chess.com/en/articles/8705305-how-do-i-get-a-pgn-of-my-game). Knightline reads embedded PGN evaluation tags, standard move symbols, comments, arrows, and highlighted squares when they are present. An export may contain only some or none of those details; Knightline reports what it actually finds.

When the PGN doesn't carry move-by-move review data, use **Analyze game** to run fresh Stockfish analysis. Those results are useful but are not presented as Chess.com's original review.

## Chess.com integration boundaries

Knightline uses Chess.com's official Published-Data API. That API is public and read-only: it provides public profile, rating, and game archive data, but does not accept moves or commands for live games. For live play, sign-in, and account actions, use Chess.com directly. Apps that need account authentication (OAuth) or Connected Board access must use [Chess.com's official request form](https://docs.google.com/forms/d/e/1FAIpQLSds2AeKLj9xqgu96Pu-rEAS0ItyqDbZbSgUFer0Mo6qMRx4Jg/viewform); Chess.com reviews those requests separately.

The public API can serve cached data; profile and game information may not reflect changes immediately. The app requests data sequentially to avoid unnecessary parallel traffic.

The monthly archive can include a game's `accuracies` values and the players' recorded ratings. Knightline displays those published scores when present. The public archive does not provide the original move-by-move Game Review annotations, evaluation graph, coach text, or arrows. Those details are not reconstructed from Chess.com's private review service.

When a review is requested, Knightline runs Stockfish locally in the browser against every position in the PGN. Move classifications, evaluation graphs, best-move arrows, alternate lines, and tactical continuation previews are fresh independent engine analysis when no corresponding original PGN annotations are supplied. They can differ from Chess.com's Game Review because the engine version, depth, settings, and scoring rules may differ. The independent accuracy estimate is a simplified measure based on average centipawn loss, not an official Chess.com score.

Knightline only offers analysis for archived/completed games. It does not analyze a live Chess.com game, automate moves, or submit commands to Chess.com. It does not collect Chess.com passwords, session cookies, or authentication tokens.

## Independence and attribution

Knightline is an independent community project. It is not affiliated with, endorsed by, or sponsored by Chess.com. Chess.com and its related marks are the property of their respective owners. The app uses a distinct visual design and does not include Chess.com board or piece artwork. Stockfish.js is loaded from the pinned v19.0.1 npm release; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for engine source and licensing.
