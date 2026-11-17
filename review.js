(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const ENGINE_WASM = "https://cdn.jsdelivr.net/npm/stockfish@19.0.1/bin/stockfish-19-lite-single.wasm";
  const state = {
    engine: null,
    running: false,
    cancelled: false,
    review: null,
    selectedPgn: "",
    selectedGame: null,
    selectedUsername: "",
    originalNotes: [],
    originalEvalCount: 0,
    runId: 0
  };

  const analyzeButton = $("#analyze-game");
  const cancelButton = $("#cancel-analysis");
  const statusEl = $("#analysis-status");
  const progressEl = $("#analysis-progress");
  const resultsEl = $("#analysis-results");
  const moveFeedbackEl = $("#move-feedback");
  const selectedReviewEl = $("#selected-move-review");
  const evalGraph = $("#evaluation-graph");
  const evalFill = $("#eval-fill");
  const evalScore = $("#eval-score");
  const arrowSvg = $("#board-arrows");

  function setStatus(message, error = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", Boolean(error));
  }

  function setProgress(value) {
    progressEl.style.width = Math.max(0, Math.min(100, value)) + "%";
  }

  function setRunning(running) {
    state.running = running;
    analyzeButton.disabled = running || !state.selectedPgn;
    analyzeButton.textContent = running ? "Analyzing…" : (state.review ? "Re-analyze" : "Analyze game");
    cancelButton.classList.toggle("hidden", !running);
  }

  class StockfishClient {
    constructor() {
      this.worker = null;
      this.readyResolve = null;
      this.readyReject = null;
      this.ready = new Promise((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
      });
      this.activeSearch = null;
      this.dead = false;
      this.handshakeTimer = setTimeout(() => this.fail(new Error("Stockfish did not finish starting.")), 30000);

      const workerUrl = "./stockfish-worker.js#" + encodeURIComponent(ENGINE_WASM) + ",worker";
      try {
        this.worker = new Worker(workerUrl);
      } catch (error) {
        this.fail(new Error("This browser could not start the chess engine: " + error.message));
        return;
      }

      this.worker.onmessage = (event) => this.receive(String(event.data || ""));
      this.worker.onerror = (event) => this.fail(new Error(event.message || "The Stockfish worker failed."));
      this.worker.postMessage("uci");
    }

    receive(line) {
      if (!line || this.dead) return;

      if (line === "uciok") {
        this.worker.postMessage("setoption name Hash value 16");
        this.worker.postMessage("setoption name MultiPV value 2");
        this.worker.postMessage("isready");
        return;
      }

      if (line === "readyok" && this.readyResolve) {
        clearTimeout(this.handshakeTimer);
        const resolve = this.readyResolve;
        this.readyResolve = null;
        this.readyReject = null;
        resolve();
        return;
      }

      const job = this.activeSearch;
      if (!job) return;

      if (line.startsWith("info ")) {
        const depthMatch = line.match(/\bdepth\s+(\d+)/);
        const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
        const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
        const pvMatch = line.match(/\bpv\s+(.+)$/);
        if (depthMatch && scoreMatch && pvMatch) {
          const multipv = multipvMatch ? Number(multipvMatch[1]) : 1;
          const depth = Number(depthMatch[1]);
          const existing = job.lines.get(multipv);
          if (!existing || depth >= existing.depth) {
            job.lines.set(multipv, {
              depth,
              scoreType: scoreMatch[1],
              score: Number(scoreMatch[2]),
              pv: pvMatch[1].trim().split(/\s+/)
            });
          }
          if (job.onProgress) job.onProgress(depth);
        }
        return;
      }

      if (line.startsWith("bestmove ")) {
        clearTimeout(job.timer);
        const bestMove = line.split(/\s+/)[1] || "";
        const lines = [...job.lines.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([multipv, data]) => ({ multipv, ...data }));
        this.activeSearch = null;
        job.resolve({ bestMove, lines });
      }
    }

    fail(error) {
      if (this.dead) return;
      this.dead = true;
      clearTimeout(this.handshakeTimer);
      try { this.worker && this.worker.terminate(); } catch {}
      if (this.readyReject) {
        this.readyReject(error);
        this.readyResolve = null;
        this.readyReject = null;
      }
      if (this.activeSearch) {
        clearTimeout(this.activeSearch.timer);
        this.activeSearch.reject(error);
        this.activeSearch = null;
      }
    }

    async analyze(fen, depth, onProgress) {
      await this.ready;
      if (this.dead) throw new Error("The chess engine is no longer running.");
      if (this.activeSearch) throw new Error("The chess engine is already analyzing another position.");

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.fail(new Error("A position took too long to analyze. Try a lower depth.")), 60000);
        this.activeSearch = { resolve, reject, timer, lines: new Map(), onProgress };
        try {
          this.worker.postMessage("position fen " + fen);
          this.worker.postMessage("go depth " + depth);
        } catch (error) {
          this.fail(error);
        }
      });
    }

    terminate() {
      if (this.dead) return;
      this.dead = true;
      clearTimeout(this.handshakeTimer);
      try { this.worker && this.worker.terminate(); } catch {}
      if (this.activeSearch) {
        clearTimeout(this.activeSearch.timer);
        this.activeSearch.reject(new Error("Analysis stopped."));
        this.activeSearch = null;
      }
      if (this.readyReject) {
        this.readyReject(new Error("Analysis stopped."));
        this.readyResolve = null;
        this.readyReject = null;
      }
    }
  }

  function parseGamePositions(pgn) {
    if (typeof window.Chess !== "function") throw new Error("Chess rules library did not load. Reload and try again.");
    const parsed = new window.Chess();
    let loaded = false;
    try { loaded = parsed.load_pgn(pgn); } catch (error) { throw new Error("This PGN could not be parsed: " + error.message); }
    if (!loaded) throw new Error("This game PGN could not be read.");

    const moves = parsed.history({ verbose: true });
    if (!Array.isArray(moves) || !moves.length) throw new Error("This game does not contain any replayable moves.");

    const replay = new window.Chess();
    const positions = [{ fen: replay.fen(), turn: "w" }];
    const normalizedMoves = [];

    for (const move of moves) {
      const accepted = replay.move({ from: move.from, to: move.to, promotion: move.promotion });
      if (!accepted) throw new Error("The PGN contains a move that could not be replayed.");
      normalizedMoves.push({
        from: move.from,
        to: move.to,
        san: accepted.san,
        color: accepted.color,
        flags: accepted.flags,
        promotion: accepted.promotion || ""
      });
      positions.push({ fen: replay.fen(), turn: replay.turn() });
    }

    return { positions, moves: normalizedMoves, headers: readHeaders(pgn) };
  }


  function parsePgnAnnotations(pgn, moveCount) {
    const notes = Array.from({ length: moveCount }, () => ({
      comments: [], nags: [], arrows: [], squares: [], eval: null
    }));
    const body = String(pgn).replace(/^\s*\[[^\]]*\]\s*$/gm, " ");
    const tokens = body.match(/\{[^}]*\}|;[^\n]*|\(|\)|\$\d+|\d+\.(?:\.\.)?|[^\s{}()]+/g) || [];
    let moveIndex = -1;
    let variationDepth = 0;

    const attachNag = (symbol) => {
      if (moveIndex >= 0 && moveIndex < notes.length && symbol && !notes[moveIndex].nags.includes(symbol)) {
        notes[moveIndex].nags.push(symbol);
      }
    };
    const attachComment = (comment) => {
      if (moveIndex < 0 || moveIndex >= notes.length) return;
      const note = notes[moveIndex];
      const evalMatch = comment.match(/\[%eval\s+([+-]?(?:\d+(?:\.\d+)?|#\d+))\]/i);
      if (evalMatch) {
        const raw = evalMatch[1];
        const mateMatch = raw.match(/^([+-]?)#(\d+)$/);
        if (mateMatch) {
          const sign = mateMatch[1] === "-" ? -1 : 1;
          const distance = Number(mateMatch[2]);
          note.eval = { type: "mate", value: sign * distance, whiteCp: sign * (10000 - distance * 10) };
        } else {
          const value = Number(raw);
          if (Number.isFinite(value)) note.eval = { type: "cp", value, whiteCp: Math.round(value * 100) };
        }
      }
      for (const match of comment.matchAll(/\[%cal\s+([^\]]+)\]/ig)) {
        for (const item of match[1].split(",")) {
          const arrow = item.trim().match(/^([GRYB])([a-h][1-8])([a-h][1-8])$/i);
          if (arrow) note.arrows.push({ color: arrow[1].toLowerCase(), from: arrow[2], to: arrow[3] });
        }
      }
      for (const match of comment.matchAll(/\[%csl\s+([^\]]+)\]/ig)) {
        for (const item of match[1].split(",")) {
          const square = item.trim().match(/^([GRYB])([a-h][1-8])$/i);
          if (square) note.squares.push({ color: square[1].toLowerCase(), square: square[2] });
        }
      }
      const plain = comment
        .replace(/\[%eval\s+[^\]]+\]/ig, "")
        .replace(/\[%cal\s+[^\]]+\]/ig, "")
        .replace(/\[%csl\s+[^\]]+\]/ig, "")
        .replace(/\[%[a-z]+\s+[^\]]+\]/ig, "")
        .replace(/\s+/g, " ")
        .trim();
      if (plain) note.comments.push(plain);
    };

    for (let token of tokens) {
      if (token === "(") { variationDepth += 1; continue; }
      if (token === ")") { variationDepth = Math.max(0, variationDepth - 1); continue; }
      if (variationDepth > 0) continue;

      if (token.startsWith("{") && token.endsWith("}")) {
        attachComment(token.slice(1, -1));
        continue;
      }
      if (token.startsWith(";")) {
        attachComment(token.slice(1));
        continue;
      }
      if (/^(!!|\?\?|!\?|\?!|!|\?)$/.test(token)) {
        attachNag(token);
        continue;
      }
      if (/^\$\d+$/.test(token)) {
        const nag = Number(token.slice(1));
        const symbol = ({ 1: "!", 2: "?", 3: "!!", 4: "??", 5: "!?", 6: "?!" })[nag];
        if (symbol) attachNag(symbol);
        continue;
      }
      if (/^\d+\.(?:\.\.)?$/.test(token)) continue;
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) continue;

      let moveToken = token.replace(/^\d+\.(?:\.\.)?/, "");
      if (!moveToken || moveToken === "e.p." || moveToken === "...") continue;
      const symbolMatch = moveToken.match(/(!!|\?\?|!\?|\?!|!|\?)$/);
      const symbol = symbolMatch ? symbolMatch[1] : "";
      if (symbol) moveToken = moveToken.slice(0, -symbol.length);
      moveToken = moveToken.replace(/[+#]+$/, "");
      if (!moveToken) continue;

      moveIndex += 1;
      if (moveIndex >= notes.length) break;
      if (symbol) attachNag(symbol);
    }

    return notes;
  }

  function readHeaders(pgn) {
    const header = (name) => {
      const match = String(pgn).match(new RegExp("^\\[" + name + '\\s+"([^"]*)"\\]', "mi"));
      return match ? match[1] : "";
    };
    return {
      white: header("White"),
      black: header("Black"),
      whiteElo: header("WhiteElo"),
      blackElo: header("BlackElo"),
      whiteAccuracy: header("WhiteAccuracy"),
      blackAccuracy: header("BlackAccuracy"),
      date: header("Date"),
      eco: header("ECO"),
      opening: header("Opening")
    };
  }

  function whiteCentipawns(line, turn) {
    if (!line) return 0;
    let cp;
    if (line.scoreType === "mate") {
      const mate = line.score;
      cp = mate > 0 ? 10000 - Math.abs(mate) * 10 : -10000 + Math.abs(mate) * 10;
    } else {
      cp = line.score;
    }
    return turn === "w" ? cp : -cp;
  }

  function uciToSan(fen, uciMoves) {
    const chess = new window.Chess();
    if (!chess.load(fen)) return [];
    const san = [];
    for (const uci of (uciMoves || [])) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uci)) break;
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4].toLowerCase() : undefined
      });
      if (!move) break;
      san.push(move.san);
    }
    return san;
  }

  function gradeMove(loss, bestMoveMatch, moverAdvantage) {
    if (bestMoveMatch) return "Best";
    if (moverAdvantage >= 300 && loss >= 120) return "Miss";
    if (loss <= 25) return "Excellent";
    if (loss <= 65) return "Good";
    if (loss <= 120) return "Inaccuracy";
    if (loss <= 250) return "Mistake";
    return "Blunder";
  }

  function gradeClass(label) {
    return label.toLowerCase().replace(/[^a-z]+/g, "-");
  }

  function estimateAccuracy(losses) {
    if (!losses.length) return null;
    const average = losses.reduce((sum, loss) => sum + loss, 0) / losses.length;
    return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-average / 165))));
  }


  function moveLoss(before, after, color) {
    const delta = color === "w" ? before - after : after - before;
    return Math.max(0, delta);
  }

  function formatEval(cp) {
    if (!Number.isFinite(cp)) return "—";
    if (Math.abs(cp) >= 9900) return cp > 0 ? "M+" : "M−";
    const pawns = cp / 100;
    return (pawns > 0 ? "+" : "") + pawns.toFixed(1);
  }

  function formatLoss(cp) {
    if (!Number.isFinite(cp)) return "—";
    return Math.round(cp) + " cp lost";
  }

  function formatPv(fen, pv) {
    const sans = uciToSan(fen, pv);
    if (!sans.length) return "No continuation available";
    return sans.map((san, index) => {
      const side = index % 2 === 0 ? "w" : "b";
      const moveNumber = Math.floor(index / 2) + 1;
      return (side === "w" ? moveNumber + ". " : "") + san;
    }).join(" ");
  }

  function drawArrows(position) {
    if (!arrowSvg) return;
    arrowSvg.querySelectorAll("line").forEach((line) => line.remove());
    if (!position) return;

    const note = position.originalNote;
    if (note && note.arrows.length) {
      note.arrows.forEach((arrow) => {
        const fromFile = arrow.from.charCodeAt(0) - 97;
        const fromRank = Number(arrow.from[1]);
        const toFile = arrow.to.charCodeAt(0) - 97;
        const toRank = Number(arrow.to[1]);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(fromFile + 0.5));
        line.setAttribute("y1", String(8 - fromRank + 0.5));
        line.setAttribute("x2", String(toFile + 0.5));
        line.setAttribute("y2", String(8 - toRank + 0.5));
        line.setAttribute("class", "original-arrow " + arrow.color);
        line.setAttribute("marker-end", "url(#original-" + arrow.color + "-head)");
        arrowSvg.append(line);
      });
    }
    if (note && note.squares.length) {
      note.squares.forEach((square) => {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        const file = square.square.charCodeAt(0) - 97;
        const rank = Number(square.square[1]);
        circle.setAttribute("cx", String(file + 0.5));
        circle.setAttribute("cy", String(8 - rank + 0.5));
        circle.setAttribute("r", ".40");
        circle.setAttribute("class", "original-square " + square.color);
        arrowSvg.append(circle);
      });
    }
    (position.lines || []).slice(0, 2).forEach((candidate, index) => {
      const move = candidate.pv && candidate.pv[0];
      if (!move || !/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(move)) return;
      const fromFile = move.charCodeAt(0) - 97;
      const fromRank = Number(move[1]);
      const toFile = move.charCodeAt(2) - 97;
      const toRank = Number(move[3]);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(fromFile + 0.5));
      line.setAttribute("y1", String(8 - fromRank + 0.5));
      line.setAttribute("x2", String(toFile + 0.5));
      line.setAttribute("y2", String(8 - toRank + 0.5));
      line.setAttribute("class", index === 0 ? "best-line" : "alt-line");
      arrowSvg.append(line);
    });
  }

  function updateEvalBar(position) {
    if (!position || (position.originalWhiteCp == null && position.whiteCp == null)) {
      evalFill.style.height = "50%";
      evalScore.textContent = "No eval";
      return;
    }
    const cp = position.originalWhiteCp ?? position.whiteCp ?? 0;
    const ratio = 1 / (1 + Math.exp(-Math.max(-1000, Math.min(1000, cp)) / 250));
    evalFill.style.height = (ratio * 100).toFixed(1) + "%";
    evalScore.textContent = formatEval(cp);
  }

  function drawEvaluationGraph(review) {
    const ctx = evalGraph.getContext("2d");
    const width = evalGraph.width;
    const height = evalGraph.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#182532";
    ctx.fillRect(0, 0, width, height);

    const top = 12;
    const bottom = height - 17;
    const center = (top + bottom) / 2;
    ctx.strokeStyle = "rgba(220,235,240,.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (bottom - top) * i / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(220,235,240,.3)";
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(0, center);
    ctx.lineTo(width, center);
    ctx.stroke();
    ctx.setLineDash([]);

    const values = review.positions.map((position) => Math.max(-1000, Math.min(1000, position.chartWhiteCp ?? position.whiteCp ?? 0)));
    if (values.length < 2) return;
    const xFor = (i) => 4 + i / (values.length - 1) * (width - 8);
    const yFor = (cp) => {
      const normalized = Math.tanh(cp / 450);
      return center - normalized * ((bottom - top) / 2 - 2);
    };

    ctx.fillStyle = "rgba(166,197,170,.10)";
    ctx.beginPath();
    ctx.moveTo(xFor(0), center);
    values.forEach((cp, i) => ctx.lineTo(xFor(i), yFor(cp)));
    ctx.lineTo(xFor(values.length - 1), center);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#a6c5aa";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    values.forEach((cp, i) => {
      if (i === 0) ctx.moveTo(xFor(i), yFor(cp));
      else ctx.lineTo(xFor(i), yFor(cp));
    });
    ctx.stroke();

    ctx.fillStyle = "#d5e4d5";
    values.forEach((cp, i) => {
      if (i % Math.max(1, Math.floor(values.length / 28)) !== 0 && i !== values.length - 1) return;
      ctx.beginPath();
      ctx.arc(xFor(i), yFor(cp), 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#8fa3ad";
    ctx.font = "10px monospace";
    ctx.fillText("WHITE", 6, 10);
    ctx.fillText("BLACK", 6, height - 3);
  }

  function makeMoveFeedback(review) {
    moveFeedbackEl.replaceChildren();
    const fragment = document.createDocumentFragment();
    const counts = {};
    review.moveReviews.forEach((item, index) => {
      counts[item.grade] = (counts[item.grade] || 0) + 1;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "feedback-row";
      row.dataset.moveIndex = String(index + 1);
      const number = document.createElement("span");
      number.className = "feedback-number";
      number.textContent = (Math.floor(index / 2) + 1) + (item.color === "w" ? "." : "…");
      const moveText = document.createElement("span");
      moveText.className = "feedback-move";
      const moveName = document.createElement("strong");
      moveName.textContent = (item.color === "w" ? "White " : "Black ") + item.san;
      const detail = document.createElement("span");
      const sourceMark = item.originalNote && item.originalNote.nags.length ? " · Original PGN " + item.originalNote.nags.join(" ") : "";
      const sourceComment = item.originalNote && item.originalNote.comments.length ? " · " + item.originalNote.comments.join(" ").slice(0, 110) : "";
      detail.textContent = review.sourceOnly
        ? ((item.originalNote && (item.originalNote.comments.length || item.originalNote.nags.length || item.originalNote.eval)) ? "Source annotation" : "No original note") + sourceMark + sourceComment
        : (item.bestMoveMatch ? "Engine's top choice" : formatLoss(item.loss)) + sourceMark + sourceComment;
      if (sourceComment) detail.title = item.originalNote.comments.join(" ");
      moveText.append(moveName, detail);
      const grade = document.createElement("span");
      grade.className = "grade-pill " + gradeClass(item.grade);
      grade.textContent = item.originalNote && item.originalNote.nags.length ? "PGN " + item.originalNote.nags[0] : item.grade;
      if (item.originalNote && item.originalNote.nags.length) grade.classList.add("original-annotation");
      row.append(number, moveText, grade);
      row.addEventListener("click", () => window.KnightlineBridge.setMove(index + 1));
      fragment.append(row);
    });
    moveFeedbackEl.append(fragment);

    const critical = (counts.Blunder || 0) + (counts.Mistake || 0) + (counts.Inaccuracy || 0) + (counts.Miss || 0);
    $("#move-feedback-count").textContent = review.moveReviews.length + " reviewed · " + critical + " key errors";
  }

  function showSelectedPosition(moveIndex) {
    const review = state.review;
    if (!review) {
      drawArrows(null);
      updateEvalBar(null);
      return;
    }
    const index = Math.max(0, Math.min(review.positions.length - 1, moveIndex));
    const position = review.positions[index];
    updateEvalBar(position);
    drawArrows(position);

    moveFeedbackEl.querySelectorAll(".feedback-row").forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.moveIndex) === index);
    });

    const lastMove = index > 0 ? review.moveReviews[index - 1] : null;
    const sideToMove = position.turn === "w" ? "White" : "Black";
    const best = position.lines && position.lines[0];
    const second = position.lines && position.lines[1];
    const bestLine = best ? formatPv(position.fen, best.pv) : "No continuation available";
    const secondLine = second ? formatPv(position.fen, second.pv) : "";

    selectedReviewEl.replaceChildren();
    const metrics = document.createElement("div");
    metrics.className = "review-metric";
    const metricLabel = document.createElement("span");
    metricLabel.textContent = "Evaluation";
    const metricValue = document.createElement("span");
    metricValue.textContent = formatEval(position.originalWhiteCp ?? position.whiteCp) + " · " + sideToMove + " to move" + (position.originalWhiteCp != null ? " · Original PGN" : " · Stockfish");
    metrics.append(metricLabel, metricValue);
    selectedReviewEl.append(metrics);

    if (lastMove) {
      const gradeMetric = document.createElement("div");
      gradeMetric.className = "review-metric";
      const gradeLabel = document.createElement("span");
      gradeLabel.textContent = "Last move";
      const gradeValue = document.createElement("span");
      gradeValue.textContent = lastMove.grade + " · " + formatLoss(lastMove.loss);
      gradeMetric.append(gradeLabel, gradeValue);
      selectedReviewEl.append(gradeMetric);

      const bestMetric = document.createElement("div");
      bestMetric.className = "review-metric";
      const bestLabel = document.createElement("span");
      bestLabel.textContent = "Best instead";
      const bestValue = document.createElement("span");
      bestValue.textContent = lastMove.bestMoveSan || "—";
      bestMetric.append(bestLabel, bestValue);
      selectedReviewEl.append(bestMetric);
    }

    const lineHeading = document.createElement("strong");
    lineHeading.textContent = "Engine's principal variation";
    selectedReviewEl.append(lineHeading);
    const line = document.createElement("div");
    line.className = "continuation-line";
    line.textContent = bestLine;
    selectedReviewEl.append(line);

    if (secondLine) {
      const altLabel = document.createElement("strong");
      altLabel.textContent = "Alternative candidate";
      selectedReviewEl.append(altLabel);
      const alt = document.createElement("div");
      alt.className = "continuation-line";
      alt.textContent = secondLine;
      selectedReviewEl.append(alt);
    }

    const originalNote = position.originalNote;
    if (originalNote) {
      if (originalNote.nags.length) {
        const originalMark = document.createElement("div");
        originalMark.className = "review-metric";
        const originalLabel = document.createElement("span");
        originalLabel.textContent = "Original PGN judgement";
        const originalValue = document.createElement("span");
        originalValue.textContent = originalNote.nags.join(" ");
        originalMark.append(originalLabel, originalValue);
        selectedReviewEl.append(originalMark);
      }
      if (originalNote.comments.length) {
        const comment = document.createElement("div");
        comment.className = "original-comment";
        comment.textContent = "Original PGN comment: " + originalNote.comments.join(" ");
        selectedReviewEl.append(comment);
      }
    }

    const tactical = document.createElement("div");
    tactical.className = "threat-note";
    const lineMoves = best ? uciToSan(position.fen, best.pv) : [];
    if (lineMoves.some((san) => san.includes("x") || san.includes("+") || san.includes("#"))) {
      tactical.textContent = "Tactical alert: the engine's top line contains a capture or check. Follow the continuation to inspect it.";
    } else {
      tactical.textContent = "Threat preview: follow the engine's top continuation to see the strongest reply and its follow-up.";
    }
    selectedReviewEl.append(tactical);
  }

  function renderSummary(review) {
    const whiteName = review.headers.white || state.selectedGame?.white?.username || "White";
    const blackName = review.headers.black || state.selectedGame?.black?.username || "Black";
    const originalAccuracy = state.selectedGame?.accuracies || {
      white: review.headers.whiteAccuracy,
      black: review.headers.blackAccuracy
    };
    const chessComAccuracy = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return null;
      return Math.max(0, Math.min(100, numeric <= 1 ? numeric * 100 : numeric));
    };
    const whiteOriginal = chessComAccuracy(originalAccuracy.white);
    const blackOriginal = chessComAccuracy(originalAccuracy.black);

    if (review.sourceOnly) {
      $("#white-analysis-name").textContent = whiteName.toUpperCase() + " · ORIGINAL ACCURACY";
      $("#black-analysis-name").textContent = blackName.toUpperCase() + " · ORIGINAL ACCURACY";
      $("#white-accuracy").textContent = whiteOriginal == null ? "—" : whiteOriginal.toFixed(1) + "%";
      $("#black-accuracy").textContent = blackOriginal == null ? "—" : blackOriginal.toFixed(1) + "%";
      const whiteRating = state.selectedGame?.white?.rating || review.headers.whiteElo;
      const blackRating = state.selectedGame?.black?.rating || review.headers.blackElo;
      $("#white-performance").textContent = whiteRating ? "Recorded game rating " + Number(whiteRating).toLocaleString() : "No game rating in this PGN";
      $("#black-performance").textContent = blackRating ? "Recorded game rating " + Number(blackRating).toLocaleString() : "No game rating in this PGN";
      const sourceItems = review.moveReviews.reduce((sum, item) => sum + (item.originalNote ? item.originalNote.comments.length + item.originalNote.nags.length + item.originalNote.arrows.length + item.originalNote.squares.length + (item.originalNote.eval ? 1 : 0) : 0), 0);
      $("#game-quality").textContent = String(sourceItems);
      $("#game-quality-sub").textContent = "Original PGN annotations";
      return;
    }

    $("#white-analysis-name").textContent = whiteOriginal == null ? whiteName.toUpperCase() + " · ENGINE ESTIMATE" : whiteName.toUpperCase() + " · CHESS.COM ACCURACY";
    $("#black-analysis-name").textContent = blackOriginal == null ? blackName.toUpperCase() + " · ENGINE ESTIMATE" : blackName.toUpperCase() + " · CHESS.COM ACCURACY";

    const whiteLosses = review.moveReviews.filter((item) => item.color === "w").map((item) => item.loss);
    const blackLosses = review.moveReviews.filter((item) => item.color === "b").map((item) => item.loss);
    const whiteEstimate = estimateAccuracy(whiteLosses);
    const blackEstimate = estimateAccuracy(blackLosses);
    const recordedWhiteRating = state.selectedGame?.white?.rating || review.headers.whiteElo;
    const recordedBlackRating = state.selectedGame?.black?.rating || review.headers.blackElo;

    $("#white-accuracy").textContent = whiteOriginal == null ? (whiteEstimate == null ? "—" : whiteEstimate + "%") : whiteOriginal.toFixed(1) + "%";
    $("#black-accuracy").textContent = blackOriginal == null ? (blackEstimate == null ? "—" : blackEstimate + "%") : blackOriginal.toFixed(1) + "%";
    $("#white-performance").textContent = [
      recordedWhiteRating ? "Game rating " + Number(recordedWhiteRating).toLocaleString() : "Game rating not recorded",
      "Independent estimate " + (whiteEstimate == null ? "—" : whiteEstimate + "%")
    ].join(" · ");
    $("#black-performance").textContent = [
      recordedBlackRating ? "Game rating " + Number(recordedBlackRating).toLocaleString() : "Game rating not recorded",
      "Independent estimate " + (blackEstimate == null ? "—" : blackEstimate + "%")
    ].join(" · ");

    const reviewed = review.moveReviews.length;
    const bestCount = review.moveReviews.filter((item) => item.grade === "Best" || item.grade === "Excellent").length;
    $("#game-quality").textContent = reviewed ? Math.round(bestCount / reviewed * 100) + "%" : "—";
    $("#game-quality-sub").textContent = bestCount + " best/excellent of " + reviewed + " moves";
  }

  async function runReview() {
    if (!state.selectedPgn || state.running) return;
    const runId = ++state.runId;
    if (!window.KnightlineBridge) {
      setStatus("The game viewer is not ready. Reload the page and try again.", true);
      return;
    }

    let parsed;
    try { parsed = parseGamePositions(state.selectedPgn); }
    catch (error) { setStatus(error.message, true); return; }

    state.cancelled = false;
    state.review = null;
    resultsEl.classList.add("hidden");
    setProgress(0);
    setRunning(true);
    setStatus("Starting Stockfish 19 Lite. Engine files are loaded only when you request a review…");
    drawArrows(null);
    updateEvalBar(null);

    const depth = Number($("#analysis-depth").value) || 10;
    const total = parsed.positions.length;
    try {
      state.engine = new StockfishClient();
      await state.engine.ready;
      if (state.cancelled) throw new Error("Analysis stopped.");
      state.engine.worker.postMessage("ucinewgame");

      const evaluated = [];
      for (let i = 0; i < parsed.positions.length; i += 1) {
        if (state.cancelled || runId !== state.runId) throw new Error("Analysis stopped.");
        const current = parsed.positions[i];
        const result = await state.engine.analyze(current.fen, depth, (currentDepth) => {
          if (i === 0 || i % 4 === 0) setStatus("Analyzing position " + (i + 1) + " of " + total + " · depth " + currentDepth);
        });
        const bestLine = result.lines.find((line) => line.multipv === 1) || result.lines[0] || null;
        const whiteCp = bestLine ? whiteCentipawns(bestLine, current.turn) : 0;
        evaluated.push({
          fen: current.fen,
          turn: current.turn,
          whiteCp,
          mate: bestLine && bestLine.scoreType === "mate" ? bestLine.score : null,
          bestMove: result.bestMove,
          lines: result.lines
        });
        setProgress((i + 1) / total * 100);
        if (i % 2 === 0 || i === total - 1) {
          setStatus("Analyzed " + (i + 1) + " / " + total + " positions · depth " + depth);
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }

      if (state.cancelled || runId !== state.runId) throw new Error("Analysis stopped.");
      evaluated.forEach((position, index) => {
        const originalNote = index > 0 ? (state.originalNotes[index - 1] || null) : null;
        position.originalNote = originalNote;
        if (originalNote && originalNote.eval) position.originalWhiteCp = originalNote.eval.whiteCp;
        position.chartWhiteCp = position.originalWhiteCp != null ? position.originalWhiteCp : position.whiteCp;
      });

      const moveReviews = parsed.moves.map((move, index) => {
        const before = evaluated[index];
        const after = evaluated[index + 1];
        const playedUci = move.from + move.to + (move.promotion || "");
        const beforeBest = before.bestMove || (before.lines[0] && before.lines[0].pv[0]) || "";
        const loss = moveLoss(before.whiteCp, after.whiteCp, move.color);
        const bestMoveMatch = beforeBest && beforeBest.toLowerCase() === playedUci.toLowerCase();
        const bestMoveSan = beforeBest ? uciToSan(before.fen, [beforeBest])[0] : "";
        const moverAdvantage = move.color === "w" ? before.whiteCp : -before.whiteCp;
        const originalNote = state.originalNotes[index] || null;
        return {
          ...move,
          originalNote,
          loss,
          bestMoveMatch: Boolean(bestMoveMatch),
          bestMoveSan: bestMoveSan || "",
          grade: gradeMove(loss, Boolean(bestMoveMatch), moverAdvantage)
        };
      });

      state.review = {
        positions: evaluated,
        moves: parsed.moves,
        moveReviews,
        headers: parsed.headers,
        depth
      };

      renderSummary(state.review);
      makeMoveFeedback(state.review);
      drawEvaluationGraph(state.review);
      resultsEl.classList.remove("hidden");
      setStatus("Review complete · " + total + " positions analyzed at depth " + depth + ".");
      showSelectedPosition(window.KnightlineBridge.getMoveIndex());
    } catch (error) {
      if (runId === state.runId && !state.cancelled) setStatus(error.message || "Analysis failed. Try again.", true);
      if (runId === state.runId && state.cancelled) setStatus("Analysis stopped. You can run it again.");
    } finally {
      if (runId === state.runId) {
        if (state.engine) state.engine.terminate();
        state.engine = null;
        setRunning(false);
        state.cancelled = false;
      }
    }
  }

  function cancelReview() {
    state.cancelled = true;
    if (state.engine) state.engine.terminate();
    state.engine = null;
    setStatus("Stopping analysis…");
    cancelButton.disabled = true;
    setTimeout(() => { cancelButton.disabled = false; }, 350);
  }

  analyzeButton.addEventListener("click", runReview);
  cancelButton.addEventListener("click", cancelReview);

  const originalPgnFile = $("#original-pgn-file");
  const originalPgnText = $("#original-pgn-text");
  $("#import-original-pgn").addEventListener("click", () => {
    try {
      window.KnightlineBridge.loadPgn(originalPgnText.value);
    } catch (error) {
      setStatus(error.message || "Could not import that PGN.", true);
    }
  });
  originalPgnFile.addEventListener("change", async () => {
    const file = originalPgnFile.files && originalPgnFile.files[0];
    if (!file) return;
    try {
      originalPgnText.value = await file.text();
      setStatus("Loaded " + file.name + ". Import it to replay the game and read embedded analysis.");
    } catch (error) {
      setStatus("Could not read that local file: " + error.message, true);
    }
  });

  window.addEventListener("knightline:game-selected", (event) => {
    const detail = event.detail || {};
    state.runId += 1;
    if (state.engine) state.engine.terminate();
    state.engine = null;
    state.cancelled = true;
    state.review = null;
    state.selectedPgn = detail.pgn || "";
    state.selectedGame = detail.game || null;
    state.selectedUsername = detail.username || "";
    let parsedSelected = null;
    try { parsedSelected = parseGamePositions(state.selectedPgn); } catch {}
    state.originalNotes = parsedSelected ? parsePgnAnnotations(state.selectedPgn, parsedSelected.moves.length) : [];
    state.originalEvalCount = state.originalNotes.filter((note) => note.eval).length;
    const originalCommentCount = state.originalNotes.reduce((sum, note) => sum + note.comments.length, 0);
    const originalArrowCount = state.originalNotes.reduce((sum, note) => sum + note.arrows.length + note.squares.length, 0);
    const originalNagCount = state.originalNotes.reduce((sum, note) => sum + note.nags.length, 0);
    resultsEl.classList.add("hidden");
    moveFeedbackEl.replaceChildren();
    selectedReviewEl.textContent = "Run an analysis to reveal move judgments, the best line, and tactical continuations.";
    setProgress(0);
    setRunning(false);
    analyzeButton.disabled = !state.selectedPgn;
    if (state.originalEvalCount || originalCommentCount || originalArrowCount || originalNagCount) {
      setStatus("Original PGN data detected: " + state.originalEvalCount + " evaluations · " + originalCommentCount + " comments · " + originalArrowCount + " arrows/marks · " + originalNagCount + " judgements. Run review for full feedback.");
    } else {
      setStatus(state.selectedPgn ? "No original move analysis was embedded in this PGN. Run Stockfish for independent review." : "Select a game to begin.");
    }
    drawArrows(null);
    updateEvalBar(null);
    state.cancelled = false;
  });

  window.addEventListener("knightline:game-cleared", () => {
    state.runId += 1;
    if (state.engine) state.engine.terminate();
    state.engine = null;
    state.cancelled = true;
    state.review = null;
    state.selectedPgn = "";
    state.selectedGame = null;
    state.originalNotes = [];
    state.originalEvalCount = 0;
    resultsEl.classList.add("hidden");
    setProgress(0);
    setRunning(false);
    analyzeButton.disabled = true;
    setStatus("Choose a finished game, then run an analysis.");
    drawArrows(null);
    updateEvalBar(null);
  });

  window.addEventListener("knightline:position", (event) => {
    if (!state.review) return;
    showSelectedPosition(event.detail?.moveIndex || 0);
  });

  evalGraph.addEventListener("click", (event) => {
    if (!state.review || !window.KnightlineBridge) return;
    const rect = evalGraph.getBoundingClientRect();
    const scaleX = evalGraph.width / rect.width;
    const x = (event.clientX - rect.left) * scaleX;
    const ratio = Math.max(0, Math.min(1, x / evalGraph.width));
    const index = Math.round(ratio * (state.review.positions.length - 1));
    window.KnightlineBridge.setMove(index);
  });

  setStatus("Choose a finished game, then run an analysis.");
})();