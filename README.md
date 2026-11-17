# Knightline

Knightline is an independent, browser-based workspace for exploring public Chess.com player data and replaying archived games.

## Features

- Look up a public Chess.com username.
- View the public profile, title, country, follower count, and online status when available.
- View Bullet, Blitz, Rapid, and Daily rating snapshots, records, and peak ratings.
- Browse the player's available monthly game archives.
- Replay published PGNs on an independent chessboard with previous/next/start/end controls.
- Download the selected PGN and open the original game on Chess.com.
- Remembers the last searched username in the current browser (no passwords or Chess.com credentials are collected).

## Run locally

Open `index.html` from a local web server, or publish the repository with GitHub Pages. The app uses:

- Chess.com Published-Data API: `https://api.chess.com/pub/`
- chess.js 0.10.3 from cdnjs for PGN parsing and legal move playback.
- Google Fonts for typography.

No build step, API key, database, or server-side secret is required.

## Publish with GitHub Pages

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then save.
4. GitHub Pages will publish the site at `https://idkeman.github.io/Chess-interaction/`.

## Chess.com integration boundaries

Knightline uses Chess.com's official Published-Data API. That API is public and read-only: it provides public profile, rating, and game archive data, but does not accept moves or commands for live games. For live play, sign-in, and account actions, use Chess.com directly.

The public API can serve cached data; profile and game information may not reflect changes immediately. The app requests data sequentially to avoid unnecessary parallel traffic.

Knightline does not collect Chess.com passwords, session cookies, or authentication tokens. It does not automate gameplay, send moves, provide move recommendations, or inspect a logged-in Chess.com page.

## Independence and attribution

Knightline is an independent community project. It is not affiliated with, endorsed by, or sponsored by Chess.com. Chess.com and its related marks are the property of their respective owners. The app uses a distinct visual design and does not include Chess.com board or piece artwork.
