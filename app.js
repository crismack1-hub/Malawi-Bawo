/* =============================================================
   Malawi Bawo — engine + UI
   Single ruleset:
     - 2 seeds per pit, 32 pits in 4 rows of 8
     - On your turn, pick any of your pits with 2+ seeds AND a direction
       (clockwise or anti-clockwise). Sow one seed per pit around your
       two rows only.
     - Marker pit = your inner-row pit whose opposite (opponent's inner
       row, same column) is non-empty.
     - If your last seed lands in a marker pit, capture the seeds in
       the opposite opponent pit, then re-sow the captured pile in the
       SAME direction starting from where you captured (mtaji chain).
     - Kimbi rule: capturing at columns 0-1 (left kimbi) -> the captured
       pile is sown starting from the LEFT kichwa (col 0) going clockwise.
       Capturing at columns 6-7 (right kimbi) -> from the RIGHT kichwa
       (col 7) going anti-clockwise.
     - If the first sowing doesn't capture, the move ends (takata).
     - Mandatory capture: if any move captures, you must play one of them.
     - You lose on your turn if your inner row is empty or no pit on
       your side has 2+ seeds.
   ============================================================= */

const ROWS = 4;
const COLS = 8;
const START_SEEDS = 2;
const SOUTH = "south";
const NORTH = "north";

const CW = "cw";
const CCW = "ccw";

const MAX_RELAY = 250;
const range = (n) => [...Array(n).keys()];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ownerOf = (row) => (row >= 2 ? SOUTH : NORTH);
const innerRowFor = (p) => (p === SOUTH ? 2 : 1);
const outerRowFor = (p) => (p === SOUTH ? 3 : 0);
const opponentOf = (p) => (p === SOUTH ? NORTH : SOUTH);
const labelFor = (p) => (p === SOUTH ? "South" : "North");

const isLeftKimbi = (col) => col === 0 || col === 1;
const isRightKimbi = (col) => col === 6 || col === 7;

function pathFor(player, direction) {
  const inner = innerRowFor(player);
  const outer = outerRowFor(player);
  if (player === SOUTH) {
    if (direction === CW) {
      // Clockwise loop in south's frame: inner L->R, then outer R->L.
      return [
        ...range(COLS).map((c) => [inner, c]),
        ...range(COLS).reverse().map((c) => [outer, c]),
      ];
    }
    // Anti-clockwise: outer L->R, then inner R->L.
    return [
      ...range(COLS).map((c) => [outer, c]),
      ...range(COLS).reverse().map((c) => [inner, c]),
    ];
  }
  // NORTH (mirrored)
  if (direction === CW) {
    return [
      ...range(COLS).reverse().map((c) => [inner, c]),
      ...range(COLS).map((c) => [outer, c]),
    ];
  }
  return [
    ...range(COLS).reverse().map((c) => [outer, c]),
    ...range(COLS).map((c) => [inner, c]),
  ];
}

/* ---------------------- Engine ---------------------- */

function createGameState() {
  return {
    board: Array.from({ length: ROWS }, () => Array(COLS).fill(START_SEEDS)),
    captured: { [SOUTH]: 0, [NORTH]: 0 },
    current: SOUTH,
    gameOver: false,
    winner: null,
    message: "",
    lastMove: null,
  };
}

function cloneGame(s) {
  return {
    board: s.board.map((r) => r.slice()),
    captured: { ...s.captured },
    current: s.current,
    gameOver: s.gameOver,
    winner: s.winner,
    message: s.message,
    lastMove: s.lastMove ? JSON.parse(JSON.stringify(s.lastMove)) : null,
  };
}

function innerRowEmpty(player, board) {
  return board[innerRowFor(player)].every((n) => n === 0);
}

function executeMove(state, startRow, startCol, direction) {
  const player = state.current;
  const innerRow = innerRowFor(player);
  const oppInner = innerRowFor(opponentOf(player));
  const events = [];
  let totalCaptured = 0;

  let pickupRow = startRow;
  let pickupCol = startCol;
  let seeds = state.board[pickupRow][pickupCol];
  if (seeds < 2) return { events, totalCaptured };

  state.board[pickupRow][pickupCol] = 0;
  events.push({ type: "pickup", row: pickupRow, col: pickupCol });

  let curDir = direction;
  let safety = 0;

  while (seeds > 0 && safety < MAX_RELAY) {
    safety += 1;
    const path = pathFor(player, curDir);
    let cursor = path.findIndex(([r, c]) => r === pickupRow && c === pickupCol);
    if (cursor < 0) break;

    const stops = [];
    let lastRow = pickupRow;
    let lastCol = pickupCol;
    for (let i = 0; i < seeds; i += 1) {
      cursor = (cursor + 1) % path.length;
      [lastRow, lastCol] = path[cursor];
      state.board[lastRow][lastCol] += 1;
      stops.push([lastRow, lastCol]);
    }
    events.push({ type: "sow", direction: curDir, stops });
    seeds = 0;

    // Capture check: last seed in own inner row AND opp inner same column has seeds.
    if (lastRow === innerRow && state.board[oppInner][lastCol] > 0) {
      const captured = state.board[oppInner][lastCol];
      state.board[oppInner][lastCol] = 0;
      state.captured[player] += captured;
      totalCaptured += captured;
      events.push({
        type: "capture",
        at: [lastRow, lastCol],
        from: [oppInner, lastCol],
        count: captured,
      });

      // Kimbi rerouting.
      if (isRightKimbi(lastCol)) {
        pickupRow = innerRow;
        pickupCol = 7;
        curDir = CCW;
      } else if (isLeftKimbi(lastCol)) {
        pickupRow = innerRow;
        pickupCol = 0;
        curDir = CW;
      } else {
        pickupRow = lastRow;
        pickupCol = lastCol;
        // curDir unchanged
      }
      seeds = captured;
      continue;
    }

    // No capture from this sowing -> turn ends.
    break;
  }

  return { events, totalCaptured };
}

function legalMoves(state, player = state.current) {
  const moves = [];
  const captureMoves = [];
  for (let row = 0; row < ROWS; row += 1) {
    if (ownerOf(row) !== player) continue;
    for (let col = 0; col < COLS; col += 1) {
      if (state.board[row][col] < 2) continue;
      for (const dir of [CW, CCW]) {
        const m = { row, col, direction: dir };
        const sim = cloneGame(state);
        sim.current = player;
        const cap = executeMove(sim, row, col, dir).totalCaptured;
        moves.push(m);
        if (cap > 0) captureMoves.push(m);
      }
    }
  }
  // Mandatory capture: if any move captures, only those are legal.
  return captureMoves.length ? captureMoves : moves;
}

function applyMove(state, row, col, direction) {
  const player = state.current;
  const result = executeMove(state, row, col, direction);
  state.lastMove = {
    player,
    from: [row, col],
    direction,
    captured: result.totalCaptured,
    events: result.events,
  };
  state.current = opponentOf(player);
  settleIfNeeded(state);
  return state.lastMove;
}

function settleIfNeeded(state) {
  const curr = state.current;
  const innerEmpty = innerRowEmpty(curr, state.board);
  const hasMoves = legalMoves(state, curr).length > 0;
  if (!innerEmpty && hasMoves) return;
  state.gameOver = true;
  state.winner = opponentOf(curr);
  state.message = innerEmpty
    ? `${labelFor(state.winner)} wins — ${labelFor(curr)}'s inner row is empty.`
    : `${labelFor(state.winner)} wins — ${labelFor(curr)} has no legal move.`;
}

/* ---------------------- AI ---------------------- */

function evaluate(state, player) {
  const opp = opponentOf(player);
  const myInner = state.board[innerRowFor(player)].reduce((a, b) => a + b, 0);
  const oppInner = state.board[innerRowFor(opp)].reduce((a, b) => a + b, 0);
  const myMoves = legalMoves(state, player).length;
  const oppMoves = legalMoves(state, opp).length;
  return (
    (state.captured[player] - state.captured[opp]) * 10 +
    myInner * 2 -
    oppInner * 4 +
    myMoves * 1.0 -
    oppMoves * 1.5
  );
}

function aiPickEasy(state) {
  const moves = legalMoves(state);
  return moves[Math.floor(Math.random() * moves.length)] || null;
}

function aiPickNormal(state) {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  const mover = state.current;
  let best = null;
  let bestVal = -Infinity;
  for (const m of moves) {
    const next = cloneGame(state);
    applyMove(next, m.row, m.col, m.direction);
    const val = evaluate(next, mover) + Math.random() * 0.5;
    if (val > bestVal) {
      bestVal = val;
      best = m;
    }
  }
  return best;
}

function aiPickHard(state, depth = 3) {
  let bestMove = null;
  let bestScore = -Infinity;
  const moves = legalMoves(state);
  for (const m of moves) {
    const next = cloneGame(state);
    applyMove(next, m.row, m.col, m.direction);
    const score = -negamax(next, depth - 1, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }
  return bestMove;
}

function negamax(state, depth, alpha, beta) {
  if (state.gameOver) return -10000;
  if (depth === 0) return evaluate(state, state.current);
  const moves = legalMoves(state);
  if (!moves.length) return evaluate(state, state.current);
  let value = -Infinity;
  for (const m of moves) {
    const next = cloneGame(state);
    applyMove(next, m.row, m.col, m.direction);
    const child = -negamax(next, depth - 1, -beta, -alpha);
    if (child > value) value = child;
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return value;
}

function aiPick(state, difficulty) {
  if (difficulty === "easy") return aiPickEasy(state);
  if (difficulty === "hard") return aiPickHard(state, 3);
  return aiPickNormal(state);
}

/* ---------------------- App / UI ---------------------- */

const App = {
  screen: "home",
  difficulty: "normal",
  game: null,
  busy: false,
  selectedPit: null, // { row, col, dirs: ['cw' | 'ccw'] }
  tutorial: { stepIdx: 0, completed: false },
};

/* ---------------------- Tutorial steps ---------------------- */

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}
function standardBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(START_SEEDS));
}

const TUTORIAL_STEPS = [
  {
    title: "The board",
    text: "Malawi Bao is played on 32 pits — two rows for each player. You play South (bottom). Each pit starts with 2 seeds. The two inner rows are where captures happen.",
    boardFactory: standardBoard,
    interactive: false,
  },
  {
    title: "Sowing",
    text: "On your turn, pick any pit on your side with 2 or more seeds, then choose a direction: clockwise (↻) or anti-clockwise (↺). Your seeds sow one-by-one around your own two rows only.",
    prompt: "Click the seed pit on your side, then pick a direction.",
    boardFactory: () => {
      const b = emptyBoard();
      b[3][0] = 2;        // single south pit, no captures possible
      b[1][7] = 2;        // give north something so the game state is valid
      b[0][7] = 2;
      return b;
    },
    interactive: true,
    validate: (m) => m.row === 3 && m.col === 0,
  },
  {
    title: "Marker pit",
    text: "A pit on your inner row whose opposite (the opponent's inner-row pit at the same column) has seeds becomes a 'marker pit' — shown with a green dashed ring. If your last seed lands in a marker pit, you capture the opponent's seeds at that column.",
    prompt: "Play the highlighted pit. Watch your seeds land in your marker pit.",
    boardFactory: () => {
      const b = emptyBoard();
      b[3][7] = 2;        // sow CCW two seeds, lands at (2,6)
      b[1][6] = 3;        // opposite pit — capture target
      b[1][0] = 2; b[0][0] = 2; // dummy north pieces
      return b;
    },
    interactive: true,
    validate: (m) => m.row === 3 && m.col === 7,
  },
  {
    title: "Mtaji chain",
    text: "After capturing, the captured seeds re-sow in the same direction starting from where you captured. If your last seed lands in another marker pit, you capture again. The chain continues until a sowing doesn't capture.",
    prompt: "Play the highlighted pit. Two captures will chain.",
    boardFactory: () => {
      const b = emptyBoard();
      b[3][0] = 4;        // sow CW four seeds, lands at (2,3)
      b[1][3] = 2;        // first capture
      b[1][5] = 2;        // second capture via chain
      b[1][0] = 2; b[0][0] = 2;
      return b;
    },
    interactive: true,
    validate: (m) => m.row === 3 && m.col === 0,
  },
  {
    title: "Kimbi rule",
    text: "The first two and last two pits of your inner row are 'kimbis'. If your capture lands in a kimbi, the captured seeds sow from the kichwa (the corner pit) instead — anti-clockwise from the right kichwa (col 7), or clockwise from the left kichwa (col 0).",
    prompt: "Play the highlighted pit. You'll capture in the right kimbi and the seeds will sow from the right kichwa.",
    boardFactory: () => {
      const b = emptyBoard();
      b[2][4] = 2;        // sow CW two seeds, lands at (2,6) — right kimbi
      b[1][6] = 3;        // capture target
      b[1][0] = 2; b[0][0] = 2;
      return b;
    },
    interactive: true,
    validate: (m) => m.row === 2 && m.col === 4,
  },
  {
    title: "You're ready",
    text: "You lose your turn — and the game — if your inner row is empty or no pit on your side has 2+ seeds. If any of your moves captures, you must play a capturing move. Otherwise, pick freely.",
    boardFactory: standardBoard,
    interactive: false,
    final: true,
  },
];

function startTutorial() {
  App.tutorial = { stepIdx: 0, completed: false };
  setScreen("tutorial");
  loadTutorialStep(0);
}

function loadTutorialStep(idx) {
  if (idx < 0 || idx >= TUTORIAL_STEPS.length) return;
  const step = TUTORIAL_STEPS[idx];
  App.tutorial = { stepIdx: idx, completed: !step.interactive };
  App.selectedPit = null;
  App.busy = false;
  App.game = {
    board: step.boardFactory(),
    captured: { [SOUTH]: 0, [NORTH]: 0 },
    current: SOUTH,
    gameOver: false,
    winner: null,
    message: "",
    lastMove: null,
  };
  renderTutorial();
}

function renderTutorial() {
  const idx = App.tutorial.stepIdx;
  const step = TUTORIAL_STEPS[idx];
  $("#tutTitle").textContent = step.title;
  $("#tutText").textContent = step.text;
  $("#tutProgress").textContent = `Step ${idx + 1} of ${TUTORIAL_STEPS.length}`;
  const promptEl = $("#tutPrompt");
  if (step.prompt && !App.tutorial.completed) {
    promptEl.textContent = step.prompt;
    promptEl.hidden = false;
  } else {
    promptEl.hidden = true;
  }
  $("#tutPrev").disabled = idx === 0;
  $("#tutNext").disabled = step.interactive && !App.tutorial.completed;
  $("#tutNext").textContent = step.final ? "Start a game" : "Next";
  renderTutorialBoard();
}

function tutorialFilteredMoves() {
  const step = TUTORIAL_STEPS[App.tutorial.stepIdx];
  if (!step || !step.interactive || App.tutorial.completed) return [];
  const moves = legalMoves(App.game);
  return step.validate ? moves.filter((m) => step.validate(m)) : moves;
}

function renderTutorialBoard() {
  const game = App.game;
  if (!game) return;
  const boardEl = $("#tutBoard");
  boardEl.innerHTML = "";

  const allowed = tutorialFilteredMoves();
  const legal = new Set(allowed.map((m) => `${m.row}-${m.col}`));
  const markers = markerKeysFor(game, SOUTH);
  const oppKimbis = oppKimbiKeysFor(SOUTH);

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const key = `${row}-${col}`;
      const count = game.board[row][col];
      const pit = document.createElement("button");
      pit.type = "button";
      pit.className = "pit " + ownerOf(row);
      pit.dataset.key = key;
      pit.disabled = !legal.has(key) || App.busy;
      if (legal.has(key) && !App.busy) pit.classList.add("playable");
      if (markers.has(key)) pit.classList.add("marker");
      if (oppKimbis.has(key)) pit.classList.add("opp-kimbi");
      if (App.selectedPit && App.selectedPit.row === row && App.selectedPit.col === col) {
        pit.classList.add("selected");
      }
      pit.addEventListener("click", () => handleTutorialPitClick(row, col));

      const seedsEl = document.createElement("span");
      seedsEl.className = "seeds";
      renderSeeds(seedsEl, count);
      const badge = document.createElement("span");
      badge.className = "count";
      badge.textContent = count;
      pit.append(seedsEl, badge);
      boardEl.append(pit);
    }
  }

  // Direction picker
  const picker = $("#tutDirPicker");
  if (App.selectedPit && App.selectedPit.dirs && App.selectedPit.dirs.length) {
    picker.hidden = false;
    $("#tutDirCW").disabled = !App.selectedPit.dirs.includes(CW);
    $("#tutDirCCW").disabled = !App.selectedPit.dirs.includes(CCW);
  } else {
    picker.hidden = true;
  }
}

function handleTutorialPitClick(row, col) {
  if (App.busy || App.tutorial.completed) return;
  if (App.selectedPit && App.selectedPit.row === row && App.selectedPit.col === col) {
    App.selectedPit = null;
    renderTutorialBoard();
    return;
  }
  const allowed = tutorialFilteredMoves().filter((m) => m.row === row && m.col === col);
  if (!allowed.length) return;
  if (allowed.length === 1) {
    finishTutorialMove(row, col, allowed[0].direction);
    return;
  }
  App.selectedPit = { row, col, dirs: allowed.map((m) => m.direction) };
  renderTutorialBoard();
}

async function finishTutorialMove(row, col, direction) {
  App.selectedPit = null;
  App.busy = true;
  renderTutorialBoard();
  const preBoard = App.game.board.map((r) => r.slice());
  const sim = cloneGame(App.game);
  const result = executeMove(sim, row, col, direction);
  await animateEvents(preBoard, result.events);
  // Apply state without triggering game-end or AI.
  App.game = sim;
  App.game.lastMove = {
    player: SOUTH,
    from: [row, col],
    direction,
    captured: result.totalCaptured,
    events: result.events,
  };
  App.busy = false;
  App.tutorial.completed = true;
  renderTutorial();
}

function tutorialAdvance() {
  const idx = App.tutorial.stepIdx;
  const step = TUTORIAL_STEPS[idx];
  if (step.final) {
    setScreen("home");
    startGame();
    return;
  }
  if (step.interactive && !App.tutorial.completed) return;
  loadTutorialStep(idx + 1);
}

function tutorialPrev() {
  if (App.tutorial.stepIdx === 0) return;
  loadTutorialStep(App.tutorial.stepIdx - 1);
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function setScreen(name) {
  App.screen = name;
  document.body.dataset.screen = name;
  $$(".screen").forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function startGame() {
  App.game = createGameState();
  App.busy = false;
  App.selectedPit = null;
  setScreen("game");
  renderGame();
  setStatus(`${labelFor(SOUTH)} to move`);
}

function setStatus(msg) {
  $("#status").textContent = msg;
}

/* Compute the set of marker pit keys for the current player.
   Used as a visual aid. */
function markerKeysFor(state, player) {
  if (state.gameOver) return new Set();
  const innerRow = innerRowFor(player);
  const oppInner = innerRowFor(opponentOf(player));
  const set = new Set();
  for (let c = 0; c < COLS; c += 1) {
    if (state.board[oppInner][c] > 0) set.add(`${innerRow}-${c}`);
  }
  return set;
}

function oppKimbiKeysFor(player) {
  const set = new Set();
  const oppInner = innerRowFor(opponentOf(player));
  for (const c of [0, 1, 6, 7]) set.add(`${oppInner}-${c}`);
  return set;
}

function renderGame() {
  const game = App.game;
  if (!game) return;
  const boardEl = $("#board");
  boardEl.innerHTML = "";

  // Legal-move pits for current human (south).
  const humanTurn = game.current === SOUTH && !App.busy && !game.gameOver;
  const legal = new Set(
    humanTurn ? legalMoves(game).map((m) => `${m.row}-${m.col}`) : [],
  );

  // Visual aids.
  const markers = humanTurn ? markerKeysFor(game, SOUTH) : new Set();
  const oppKimbis = oppKimbiKeysFor(SOUTH);
  const last = game.lastMove;

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const key = `${row}-${col}`;
      const count = game.board[row][col];
      const pit = document.createElement("button");
      pit.type = "button";
      pit.className = "pit " + ownerOf(row);
      pit.dataset.key = key;
      pit.setAttribute(
        "aria-label",
        `${labelFor(ownerOf(row))} ${row === innerRowFor(ownerOf(row)) ? "inner" : "outer"} col ${col + 1}, ${count} seeds`,
      );
      pit.disabled = !legal.has(key) || App.busy || game.gameOver;
      if (legal.has(key) && !App.busy && !game.gameOver) pit.classList.add("playable");
      if (markers.has(key)) pit.classList.add("marker");
      if (oppKimbis.has(key)) pit.classList.add("opp-kimbi");
      if (App.selectedPit && App.selectedPit.row === row && App.selectedPit.col === col) {
        pit.classList.add("selected");
      }
      if (last) {
        if (last.from[0] === row && last.from[1] === col) pit.classList.add("last-from");
      }
      pit.addEventListener("click", () => handlePitClick(row, col));

      const seedsEl = document.createElement("span");
      seedsEl.className = "seeds";
      renderSeeds(seedsEl, count);
      const badge = document.createElement("span");
      badge.className = "count";
      badge.textContent = count;
      pit.append(seedsEl, badge);
      boardEl.append(pit);
    }
  }

  $("#northScore").textContent = game.captured[NORTH];
  $("#southScore").textContent = game.captured[SOUTH];
  $("#northSide").classList.toggle("active", game.current === NORTH && !game.gameOver);
  $("#southSide").classList.toggle("active", game.current === SOUTH && !game.gameOver);

  // Direction picker visibility.
  const picker = $("#dirPicker");
  if (App.selectedPit && App.selectedPit.dirs && App.selectedPit.dirs.length) {
    picker.hidden = false;
    $("#dirCW").disabled = !App.selectedPit.dirs.includes(CW);
    $("#dirCCW").disabled = !App.selectedPit.dirs.includes(CCW);
  } else {
    picker.hidden = true;
  }
}

function renderSeeds(container, count) {
  const visible = Math.min(count, 12);
  for (let i = 0; i < visible; i += 1) {
    const s = document.createElement("span");
    s.className = "seed";
    const angle = (i / Math.max(1, visible)) * Math.PI * 2;
    const radius = 22 + (i % 3) * 9;
    s.style.left = `${50 + Math.cos(angle) * radius}%`;
    s.style.top = `${50 + Math.sin(angle) * radius}%`;
    container.append(s);
  }
}

function handlePitClick(row, col) {
  const game = App.game;
  if (!game || App.busy || game.gameOver) return;
  if (game.current !== SOUTH) return;

  // Toggle off if clicking the already-selected pit.
  if (App.selectedPit && App.selectedPit.row === row && App.selectedPit.col === col) {
    App.selectedPit = null;
    renderGame();
    return;
  }

  // Confirm pit is legal.
  const moves = legalMoves(game).filter((m) => m.row === row && m.col === col);
  if (!moves.length) return;

  if (moves.length === 1) {
    // Only one direction is legal — execute immediately.
    finishMove(row, col, moves[0].direction);
    return;
  }

  // Multiple directions — show picker.
  App.selectedPit = { row, col, dirs: moves.map((m) => m.direction) };
  renderGame();
}

function finishMove(row, col, direction) {
  App.selectedPit = null;
  doMove(row, col, direction).then(() => {
    if (App.game.gameOver) {
      onGameEnded();
    } else if (App.game.current === NORTH) {
      scheduleAi();
    }
  });
}

async function doMove(row, col, direction) {
  App.busy = true;
  renderGame();
  const preBoard = App.game.board.map((r) => r.slice());
  const sim = cloneGame(App.game);
  const result = executeMove(sim, row, col, direction);
  await animateEvents(preBoard, result.events);

  const player = App.game.current;
  applyMove(App.game, row, col, direction);

  if (!App.game.gameOver) {
    if (result.totalCaptured > 0) {
      setStatus(`${labelFor(player)} captured ${result.totalCaptured}. ${labelFor(App.game.current)} to move.`);
    } else {
      setStatus(`${labelFor(App.game.current)} to move.`);
    }
  } else {
    setStatus(App.game.message);
  }
  App.busy = false;
  renderGame();
}

async function animateEvents(preBoard, events) {
  const animBoard = preBoard.map((r) => r.slice());
  let totalStops = 0;
  for (const ev of events) if (ev.type === "sow") totalStops += ev.stops.length;
  const delay = totalStops <= 4 ? 130 : totalStops <= 10 ? 75 : 50;

  for (const ev of events) {
    if (ev.type === "pickup") {
      animBoard[ev.row][ev.col] = 0;
      paintPit(ev.row, ev.col, 0);
      await sleep(110);
    } else if (ev.type === "sow") {
      for (const [r, c] of ev.stops) {
        animBoard[r][c] += 1;
        paintPit(r, c, animBoard[r][c], true);
        await sleep(delay);
      }
    } else if (ev.type === "capture") {
      const [fr, fc] = ev.from;
      const el = pitEl(fr, fc);
      if (el) el.classList.add("captured");
      await sleep(380);
      if (el) el.classList.remove("captured");
      animBoard[fr][fc] = 0;
      paintPit(fr, fc, 0);
    }
  }
}

function pitEl(row, col) {
  // Scope to the currently visible screen so the tutorial and game boards
  // don't fight over the same selector.
  const screenEl = document.querySelector(".screen:not([hidden])");
  if (!screenEl) return document.querySelector(`.pit[data-key="${row}-${col}"]`);
  return screenEl.querySelector(`.pit[data-key="${row}-${col}"]`);
}

function paintPit(row, col, count, drop = false) {
  const el = pitEl(row, col);
  if (!el) return;
  const seedsEl = el.querySelector(".seeds");
  const countEl = el.querySelector(".count");
  if (seedsEl) {
    seedsEl.innerHTML = "";
    renderSeeds(seedsEl, count);
    if (drop && seedsEl.lastChild) seedsEl.lastChild.classList.add("dropped");
  }
  if (countEl) countEl.textContent = count;
}

function scheduleAi() {
  App.busy = true;
  renderGame();
  setStatus(`North is thinking…`);
  setTimeout(async () => {
    const move = aiPick(App.game, App.difficulty);
    if (!move) {
      App.busy = false;
      settleIfNeeded(App.game);
      renderGame();
      if (App.game.gameOver) onGameEnded();
      return;
    }
    await doMove(move.row, move.col, move.direction);
    if (App.game.gameOver) onGameEnded();
  }, App.difficulty === "hard" ? 260 : 460);
}

function onGameEnded() {
  setStatus(App.game.message);
}

/* ---------------------- Wiring ---------------------- */

function bindUI() {
  $$("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const target = el.dataset.nav;
      if (target === "tutorial") {
        startTutorial();
      } else {
        setScreen(target);
      }
    });
  });

  $("#aiDifficulty").addEventListener("change", (e) => {
    App.difficulty = e.target.value;
  });

  $("#playBtn").addEventListener("click", startGame);
  $("#restartBtn").addEventListener("click", startGame);

  $("#dirCW").addEventListener("click", () => {
    if (!App.selectedPit) return;
    finishMove(App.selectedPit.row, App.selectedPit.col, CW);
  });
  $("#dirCCW").addEventListener("click", () => {
    if (!App.selectedPit) return;
    finishMove(App.selectedPit.row, App.selectedPit.col, CCW);
  });
  $("#dirCancel").addEventListener("click", () => {
    App.selectedPit = null;
    renderGame();
  });

  // Tutorial controls
  $("#tutNext").addEventListener("click", tutorialAdvance);
  $("#tutPrev").addEventListener("click", tutorialPrev);
  $("#tutSkip").addEventListener("click", () => setScreen("home"));
  $("#tutDirCW").addEventListener("click", () => {
    if (!App.selectedPit) return;
    finishTutorialMove(App.selectedPit.row, App.selectedPit.col, CW);
  });
  $("#tutDirCCW").addEventListener("click", () => {
    if (!App.selectedPit) return;
    finishTutorialMove(App.selectedPit.row, App.selectedPit.col, CCW);
  });
  $("#tutDirCancel").addEventListener("click", () => {
    App.selectedPit = null;
    renderTutorialBoard();
  });
}

function boot() {
  bindUI();
  setScreen("home");
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", boot);
