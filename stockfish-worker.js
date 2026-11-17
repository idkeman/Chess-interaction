// Knightline Stockfish worker bootstrap.
// Stockfish.js is loaded from the pinned npm release; its matching WASM is fetched
// by the worker using the URL encoded in this worker's location hash.
importScripts("https://cdn.jsdelivr.net/npm/stockfish@19.0.1/bin/stockfish-19-lite-single.js");
