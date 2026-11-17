(() => {
  "use strict";

  const API_BASE = "https://api.chess.com/pub";
  const DRAW_RESULTS = new Set([
    "agreed", "repetition", "stalemate", "insufficient", "50move",
    "timevsinsufficient", "threecheck"
  ]);
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const PIECES = {
    K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
    k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
  };

  const $ = (selector) => document.querySelector(selector);
  const state = {
    username: "",
    archives: [],
    activeArchiveUrl: "",
    games: [],
    selectedGameIndex: -1,
    replayChess: null,
    moveHistory: [],
    moveIndex: 0,
    selectedPgn: ""
  };

  const searchForm = $("#search-form");
  const usernameInput = $("#username-input");
  const searchButton = $("#search-button");
  const statusMessage = $("#status-message");
  const dashboard = $("#dashboard");
  const archiveSelect = $("#archive-select");
  const gamesList = $("#games-list");
  const ratingsGrid = $("#ratings-grid");

  function setStatus(message, type = "") {
    statusMessage.textContent = message;
    statusMessage.className = "status-message" + (type ? " " + type : "");
  }

  function setSearching(isSearching) {
    searchButton.disabled = isSearching;
    searchButton.querySelector("span").textContent = isSearching ? "Loading…" : "Find player";
    searchButton.querySelector("b").textContent = isSearching ? "…" : "→";
  }

  function requestJSONP(endpoint) {
    return new Promise((resolve, reject) => {
      let parsed;
      try {
        parsed = new URL(endpoint);
      } catch {
        reject(new Error("The Chess.com API returned an invalid archive URL."));
        return;
      }

      if (parsed.origin !== "https://api.chess.com") {
        reject(new Error("Blocked an unexpected API destination."));
        return;
      }

      const callbackName = "__knightline_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      const script = document.createElement("script");
      let finished = false;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        script.remove();
        try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Chess.com did not respond in time. Please try again."));
      }, 18000);

      window[callbackName] = (data) => {
        cleanup();
        resolve(data);
      };

      parsed.searchParams.set("callback", callbackName);
      script.async = true;
      script.src = parsed.toString();
      script.onerror = () => {
        cleanup();
        reject(new Error("Could not reach Chess.com. Check your connection and try again."));
      };
      document.head.appendChild(script);
    });
  }

  function safeDate(unixSeconds) {
    if (!unixSeconds || !Number.isFinite(Number(unixSeconds))) return "Date unavailable";
    const date = new Date(Number(unixSeconds) * 1000);
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
  }

  function monthFromArchiveUrl(url) {
    const match = String(url).match(/\/(\d{4})\/(\d{2})(?:\/|$)/);
    if (!match) return { value: String(url), label: "Archive" };
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    return {
      value: String(url),
      label: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date)
    };
  }

  function setOnlineStatus(status) {
    const wrapper = $("#online-status");
    const label = wrapper.querySelector("span");
    wrapper.className = "online-status";
    if (status === true) {
      label.textContent = "Online recently";
    } else if (status === false) {
      wrapper.classList.add("offline");
      label.textContent = "Not currently online";
    } else {
      wrapper.classList.add("unknown");
      label.textContent = "Status unavailable";
    }
  }

  function renderProfile(profile) {
    const username = profile.username || state.username;
    const displayName = profile.name || username;
    $("#profile-heading").textContent = "@" + username;
    $("#player-name").textContent = displayName;
    $("#profile-meta").textContent = [
      "@" + username,
      profile.country ? String(profile.country).split("/").pop().toUpperCase() : "",
      profile.followers != null ? Number(profile.followers).toLocaleString() + " followers" : ""
    ].filter(Boolean).join("  ·  ");
    $("#profile-bio").textContent = profile.status ? "Account status: " + profile.status : (profile.location || "");
    $("#avatar").textContent = profile.title ? profile.title.slice(0, 2) : "♟";

    const badge = $("#player-title");
    if (profile.title) {
      badge.textContent = profile.title;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }

    const profileLink = $("#profile-link");
    profileLink.href = "https://www.chess.com/member/" + encodeURIComponent(username);
    dashboard.classList.remove("hidden");
  }

  const RATING_TYPES = [
    { key: "chess_bullet", label: "Bullet" },
    { key: "chess_blitz", label: "Blitz" },
    { key: "chess_rapid", label: "Rapid" },
    { key: "chess_daily", label: "Daily" }
  ];

  function renderRatings(stats) {
    ratingsGrid.replaceChildren();
    RATING_TYPES.forEach(({ key, label }) => {
      const item = stats && stats[key];
      const last = item && item.last;
      const best = item && item.best;
      const record = item && item.record;
      const card = document.createElement("article");
      card.className = "stat-card";

      const name = document.createElement("span");
      name.className = "stat-label";
      name.textContent = label.toUpperCase();
      card.append(name);

      if (last && Number.isFinite(Number(last.rating))) {
        const rating = document.createElement("strong");
        rating.className = "stat-rating";
        rating.textContent = Number(last.rating).toLocaleString();
        card.append(rating);

        if (record) {
          const recordLine = document.createElement("span");
          recordLine.className = "stat-record";
          recordLine.textContent = [
            Number(record.win || 0).toLocaleString() + " W",
            Number(record.loss || 0).toLocaleString() + " L",
            Number(record.draw || 0).toLocaleString() + " D"
          ].join("   ·   ");
          card.append(recordLine);
        }

        if (best && best.rating) {
          const bestLine = document.createElement("span");
          bestLine.className = "stat-best";
          bestLine.textContent = "Peak " + Number(best.rating).toLocaleString();
          card.append(bestLine);
        }
      } else {
        const unavailable = document.createElement("span");
        unavailable.className = "no-rating";
        unavailable.textContent = "No rating available";
        card.append(unavailable);
      }
      ratingsGrid.append(card);
    });
  }

  function renderArchiveOptions(archives) {
    archiveSelect.replaceChildren();
    if (!archives.length) {
      const option = document.createElement("option");
      option.textContent = "No archives available";
      option.value = "";
      archiveSelect.append(option);
      archiveSelect.disabled = true;
      return;
    }

    archives.forEach((url) => {
      const archive = monthFromArchiveUrl(url);
      const option = document.createElement("option");
      option.value = archive.value;
      option.textContent = archive.label;
      archiveSelect.append(option);
    });
    archiveSelect.disabled = false;
  }

  function getResult(game) {
    const whiteResult = String(game.white && game.white.result || "").toLowerCase();
    const blackResult = String(game.black && game.black.result || "").toLowerCase();
    if (whiteResult === "win") return "1-0";
    if (blackResult === "win") return "0-1";
    if (DRAW_RESULTS.has(whiteResult) || DRAW_RESULTS.has(blackResult) || whiteResult === "draw" || blackResult === "draw") return "½-½";
    if (whiteResult === "checkmated" || whiteResult === "resigned" || whiteResult === "timeout" || whiteResult === "abandoned") return "0-1";
    if (blackResult === "checkmated" || blackResult === "resigned" || blackResult === "timeout" || blackResult === "abandoned") return "1-0";
    return "—";
  }

  function getPlayerOutcome(game) {
    const username = state.username.toLowerCase();
    const whiteName = String(game.white && game.white.username || "").toLowerCase();
    const blackName = String(game.black && game.black.username || "").toLowerCase();
    const result = getResult(game);
    if (result === "½-½") return "draw";
    const userIsWhite = whiteName === username;
    const userIsBlack = blackName === username;
    if (!userIsWhite && !userIsBlack) return "";
    return (result === "1-0" && userIsWhite) || (result === "0-1" && userIsBlack) ? "win" : "loss";
  }

  function getOpponent(game) {
    const whiteName = game.white && game.white.username || "White";
    const blackName = game.black && game.black.username || "Black";
    if (String(whiteName).toLowerCase() === state.username.toLowerCase()) return blackName;
    if (String(blackName).toLowerCase() === state.username.toLowerCase()) return whiteName;
    return whiteName + " vs " + blackName;
  }

  function renderGames(games) {
    gamesList.replaceChildren();
    gamesList.classList.toggle("empty-list", games.length === 0);
    $("#games-count").textContent = games.length ? games.length + " games in this archive" : "No games in this archive";

    if (!games.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = '<span class="empty-icon">♜</span><strong>No games found</strong><p>This month has no published games for this player.</p>';
      gamesList.append(empty);
      return;
    }

    games.forEach((game, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "game-row" + (index === state.selectedGameIndex ? " selected" : "");
      button.setAttribute("aria-label", "Replay game against " + getOpponent(game));

      const icon = document.createElement("span");
      icon.className = "game-icon";
      icon.textContent = "♟";
      const opponents = document.createElement("span");
      opponents.className = "game-opponents";
      const opponentName = document.createElement("strong");
      opponentName.textContent = "vs " + getOpponent(game);
      const detail = document.createElement("span");
      detail.textContent = [String(game.time_class || "chess").toUpperCase(), safeDate(game.end_time)].join(" · ");
      opponents.append(opponentName, detail);

      const outcome = document.createElement("span");
      outcome.className = "game-outcome " + getPlayerOutcome(game);
      outcome.textContent = getResult(game);

      button.append(icon, opponents, outcome);
      button.addEventListener("click", () => selectGame(index));
      gamesList.append(button);
    });
  }

  function renderBoard(fen) {
    const board = $("#chessboard");
    board.replaceChildren();
    const placement = String(fen || START_FEN).split(" ")[0];
    const ranks = placement.split("/");

    ranks.forEach((rank, rankIndex) => {
      let fileIndex = 0;
      const appendSquare = (pieceCharacter = "") => {
        const square = document.createElement("div");
        square.className = "square " + ((rankIndex + fileIndex) % 2 === 1 ? "light" : "dark");
        if (pieceCharacter) {
          const piece = document.createElement("span");
          piece.className = pieceCharacter === pieceCharacter.toUpperCase() ? "piece-white" : "piece-black";
          piece.textContent = PIECES[pieceCharacter] || "";
          square.append(piece);
        }
        board.append(square);
        fileIndex += 1;
      };

      for (const character of rank) {
        if (/\\d/.test(character)) {
          const emptyCount = Number(character);
          for (let empty = 0; empty < emptyCount; empty += 1) appendSquare();
        } else {
          appendSquare(character);
        }
      }
      while (fileIndex < 8) appendSquare();
    });
  }

  function updateMoveControls() {
    const hasGame = Boolean(state.replayChess);
    const atStart = state.moveIndex === 0;
    const atEnd = state.moveIndex >= state.moveHistory.length;
    $("#first-move").disabled = !hasGame || atStart;
    $("#prev-move").disabled = !hasGame || atStart;
    $("#next-move").disabled = !hasGame || atEnd;
    $("#last-move").disabled = !hasGame || atEnd;
    if (!hasGame) {
      $("#move-counter").textContent = "No game selected";
    } else if (atStart) {
      $("#move-counter").textContent = "Starting position";
    } else {
      const fullMove = Math.ceil(state.moveIndex / 2);
      const side = state.moveIndex % 2 === 1 ? "Black" : "White";
      $("#move-counter").textContent = "Move " + fullMove + " · " + side + " to play";
    }
  }

  function goToMove(index) {
    if (!state.selectedPgn || typeof window.Chess !== "function") return;
    const replay = new window.Chess();
    for (let i = 0; i < index; i += 1) {
      const moved = replay.move(state.moveHistory[i]);
      if (!moved) break;
    }
    state.replayChess = replay;
    state.moveIndex = index;
    renderBoard(replay.fen());
    updateMoveControls();
    window.dispatchEvent(new CustomEvent("knightline:position", { detail: { moveIndex: index } }));
  }

  function selectGame(index) {
    const game = state.games[index];
    if (!game) return;
    if (typeof window.Chess !== "function") {
      setStatus("The board library did not load. Reload the page and try again.", "error");
      return;
    }

    const pgn = String(game.pgn || "");
    if (!pgn) {
      setStatus("This archive entry does not include a published PGN.", "error");
      return;
    }

    const parser = new window.Chess();
    let loaded = false;
    try {
      loaded = parser.load_pgn(pgn);
    } catch (error) {
      console.warn("PGN parsing failed:", error);
    }
    if (!loaded) {
      setStatus("This game's PGN could not be read by the replay viewer.", "error");
      return;
    }

    state.selectedGameIndex = index;
    state.selectedPgn = pgn;
    state.moveHistory = parser.history();
    $("#game-result").textContent = getResult(game);
    $("#game-players").textContent = (game.white && game.white.username || "White") + "  vs  " + (game.black && game.black.username || "Black");
    $("#game-details").textContent = [
      String(game.time_class || "Chess").toUpperCase(),
      safeDate(game.end_time),
      game.time_control ? "Time control " + game.time_control : ""
    ].filter(Boolean).join(" · ");
    $("#download-pgn").disabled = false;
    const sourceLink = $("#source-game-link");
    sourceLink.classList.add("hidden");
    try {
      const originalUrl = new URL(String(game.url || ""));
      if (originalUrl.protocol === "https:" && ["chess.com", "www.chess.com"].includes(originalUrl.hostname)) {
        sourceLink.href = originalUrl.href;
        sourceLink.classList.remove("hidden");
      }
    } catch {
      // A game may not include a public Chess.com page URL.
    }
    renderGames(state.games);
    goToMove(0);
    window.dispatchEvent(new CustomEvent("knightline:game-selected", { detail: { username: state.username, game, pgn } }));
    setStatus("");
  }

  async function loadArchive(url) {
    state.activeArchiveUrl = url;
    state.games = [];
    state.selectedGameIndex = -1;
    state.selectedPgn = "";
    state.moveHistory = [];
    state.replayChess = null;
    $("#download-pgn").disabled = true;
    $("#source-game-link").classList.add("hidden");
    updateMoveControls();
    window.dispatchEvent(new CustomEvent("knightline:game-cleared"));
    renderBoard(START_FEN);
    $("#game-result").textContent = "SELECT A GAME";
    $("#game-players").textContent = "Choose a game to replay";
    $("#game-details").textContent = "Moves are displayed locally from the published PGN.";
    gamesList.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "empty-state";
    loading.innerHTML = '<span class="empty-icon">↻</span><strong>Loading archive</strong><p>Requesting this month from Chess.com…</p>';
    gamesList.classList.add("empty-list");
    gamesList.append(loading);
    $("#games-count").textContent = "Loading archive…";

    try {
      const result = await requestJSONP(url);
      state.games = Array.isArray(result.games) ? result.games : [];
      renderGames(state.games);
      setStatus("");
    } catch (error) {
      gamesList.replaceChildren();
      const message = document.createElement("div");
      message.className = "empty-state";
      const strong = document.createElement("strong");
      strong.textContent = "Archive unavailable";
      const detail = document.createElement("p");
      detail.textContent = error.message;
      message.append(strong, detail);
      gamesList.classList.add("empty-list");
      gamesList.append(message);
      $("#games-count").textContent = "Could not load archive";
      setStatus(error.message, "error");
    }
  }

  async function searchPlayer(rawUsername) {
    const username = String(rawUsername || "").trim();
    if (!/^[a-zA-Z0-9_-]{1,25}$/.test(username)) {
      setStatus("Enter a valid Chess.com username using letters, numbers, _ or -.", "error");
      usernameInput.focus();
      return;
    }

    state.username = username;
    state.archives = [];
    state.games = [];
    state.selectedGameIndex = -1;
    setSearching(true);
    setStatus("Connecting to Chess.com public data…");
    dashboard.classList.add("hidden");
    archiveSelect.disabled = true;
    $("#refresh-games").disabled = true;

    try {
      const profile = await requestJSONP(API_BASE + "/player/" + encodeURIComponent(username));
      renderProfile(profile || {});
      setStatus("Loading rating history…");

      let stats = {};
      try {
        stats = await requestJSONP(API_BASE + "/player/" + encodeURIComponent(username) + "/stats");
      } catch (error) {
        console.info("Stats unavailable:", error.message);
      }
      renderRatings(stats);

      setStatus("Checking public online status…");
      try {
        const online = await requestJSONP(API_BASE + "/player/" + encodeURIComponent(username) + "/is-online");
        setOnlineStatus(typeof online.online === "boolean" ? online.online : null);
      } catch {
        setOnlineStatus(null);
      }

      setStatus("Finding available game archives…");
      const archiveData = await requestJSONP(API_BASE + "/player/" + encodeURIComponent(username) + "/games/archives");
      state.archives = Array.isArray(archiveData.archives) ? archiveData.archives.slice().reverse() : [];
      renderArchiveOptions(state.archives);
      $("#refresh-games").disabled = state.archives.length === 0;

      try { localStorage.setItem("knightline:lastUser", username); } catch { /* Storage is optional. */ }

      if (state.archives.length) {
        archiveSelect.value = state.archives[0];
        setStatus("Profile loaded. Loading the latest available archive…");
        await loadArchive(state.archives[0]);
        if (!statusMessage.classList.contains("error")) {
          setStatus("Connected. Public data may be cached by Chess.com.");
        }
      } else {
        renderGames([]);
        setStatus("Profile loaded. No monthly game archives are available for this account.");
      }
    } catch (error) {
      dashboard.classList.add("hidden");
      setStatus(error.message.includes("404") ? "That username could not be found, or its public profile is unavailable." : error.message, "error");
    } finally {
      setSearching(false);
    }
  }

  function pgnTag(pgn, name) {
    const lines = String(pgn).match(/^\[[A-Za-z0-9_]+\s+"[^"]*"\]/gm) || [];
    for (const line of lines) {
      const match = line.match(/^\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/);
      if (match && match[1].toLowerCase() === String(name).toLowerCase()) return match[2];
    }
    return "";
  }

  function loadImportedPgn(pgn) {
    const source = String(pgn || "").trim();
    if (!source) throw new Error("Choose a PGN file or paste its contents first.");
    if (typeof window.Chess !== "function") throw new Error("The chess rules library did not load. Reload and try again.");

    const parser = new window.Chess();
    let loaded = false;
    try { loaded = parser.load_pgn(source); }
    catch (error) { throw new Error("The imported PGN could not be read: " + error.message); }
    if (!loaded) throw new Error("The imported PGN could not be parsed. Check that it contains a complete game.");

    const headers = {
      white: pgnTag(source, "White") || "White",
      black: pgnTag(source, "Black") || "Black",
      whiteElo: pgnTag(source, "WhiteElo"),
      blackElo: pgnTag(source, "BlackElo"),
      date: pgnTag(source, "Date"),
      result: pgnTag(source, "Result") || "*",
      link: pgnTag(source, "Link") || pgnTag(source, "URL") || ""
    };
    const rating = (value) => /^\\d+$/.test(value) ? Number(value) : null;
    const game = {
      pgn: source,
      url: headers.link,
      accuracies: null,
      white: { username: headers.white, rating: rating(headers.whiteElo) },
      black: { username: headers.black, rating: rating(headers.blackElo) },
      imported: true
    };

    state.selectedGameIndex = -1;
    state.selectedPgn = source;
    state.moveHistory = parser.history();
    state.replayChess = new window.Chess();
    $("#game-result").textContent = headers.result === "1-0" ? "1-0" : headers.result === "0-1" ? "0-1" : headers.result === "1/2-1/2" ? "½-½" : "—";
    $("#game-players").textContent = headers.white + "  vs  " + headers.black;
    $("#game-details").textContent = ["IMPORTED PGN", headers.date || "Date not recorded"].join(" · ");
    $("#download-pgn").disabled = false;

    const sourceLink = $("#source-game-link");
    sourceLink.classList.add("hidden");
    try {
      const originalUrl = new URL(String(headers.link || ""));
      if (originalUrl.protocol === "https:" && ["chess.com", "www.chess.com"].includes(originalUrl.hostname)) {
        sourceLink.href = originalUrl.href;
        sourceLink.classList.remove("hidden");
      }
    } catch {
      // An exported PGN may not contain its original game URL.
    }

    renderGames(state.games);
    goToMove(0);
    window.dispatchEvent(new CustomEvent("knightline:game-selected", {
      detail: { username: state.username, game, pgn: source, imported: true }
    }));
    setStatus("Imported PGN loaded. Original Computer Analysis annotations will be shown when they are embedded in the file.");
    return true;
  }

  function downloadSelectedPgn() {
    if (!state.selectedPgn) return;
    const blob = new Blob([state.selectedPgn], { type: "application/x-chess-pgn;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = (state.selectedGameIndex === -1 ? "knightline-imported-game" : (state.username || "chess-game")) + ".pgn";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchPlayer(usernameInput.value);
  });

  document.querySelectorAll("[data-example]").forEach((button) => {
    button.addEventListener("click", () => {
      usernameInput.value = button.dataset.example;
      searchPlayer(button.dataset.example);
    });
  });

  archiveSelect.addEventListener("change", () => {
    if (archiveSelect.value) loadArchive(archiveSelect.value);
  });

  $("#refresh-games").addEventListener("click", () => {
    if (state.activeArchiveUrl) loadArchive(state.activeArchiveUrl);
  });

  $("#first-move").addEventListener("click", () => goToMove(0));
  $("#prev-move").addEventListener("click", () => goToMove(Math.max(0, state.moveIndex - 1)));
  $("#next-move").addEventListener("click", () => goToMove(Math.min(state.moveHistory.length, state.moveIndex + 1)));
  $("#last-move").addEventListener("click", () => goToMove(state.moveHistory.length));
  $("#download-pgn").addEventListener("click", downloadSelectedPgn);

  window.KnightlineBridge = {
    getSelectedGame: () => state.games[state.selectedGameIndex] || null,
    getSelectedPgn: () => state.selectedPgn,
    getUsername: () => state.username,
    getMoveIndex: () => state.moveIndex,
    loadPgn: (pgn) => loadImportedPgn(pgn),
    setMove: (index) => goToMove(Math.max(0, Math.min(state.moveHistory.length, Number(index) || 0)))
  };

  renderBoard(START_FEN);
  try {
    const lastUser = localStorage.getItem("knightline:lastUser");
    if (lastUser) usernameInput.value = lastUser;
  } catch {
    // Local storage is optional; no account credentials are stored here.
  }
})();