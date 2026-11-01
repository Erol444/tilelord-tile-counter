// Tile Counter for TileLord — floating panel listing every tile still in the deck.
// Runs in the page (MAIN world) so it can read window.tlAgent.state().
(() => {
  if (window.__TLTC__) return;
  window.__TLTC__ = true;

  const { tiles: TILES, decks: DECKS } = globalThis.TLTC_DATA;
  const STORE_KEY = "tltc:ui";
  const THUMB = 44;
  const SECTIONS = [
    ["base", "Base game"],
    ["river", "River"],
    ["innsAndCathedrals", "Inns & Cathedrals"],
    ["tradersAndBuilders", "Traders & Builders"],
    ["goldmines", "Gold Mines"],
    ["dragonAndFairy", "Dragon & Fairy"],
    ["festival", "Festival"],
    ["labyrinth", "Labyrinth"],
  ];

  // Mirrors the server's deck builder: expansion sets scale with tileMultiplier, river sets do not.
  function buildDeck(s) {
    const mult = Math.max(1, Math.min(3, Number(s.tileMultiplier) || 1));
    const deck = {};
    const add = (section, set, m = 1) => {
      const out = (deck[section] ||= {});
      for (const [id, n] of Object.entries(set)) out[id] = (out[id] || 0) + n * m;
    };
    add("base", DECKS.base, mult);
    if (s.innsAndCathedrals) add("innsAndCathedrals", DECKS.innsAndCathedrals, mult);
    if (s.tradersAndBuilders) add("tradersAndBuilders", DECKS.tradersAndBuilders, mult);
    if (s.goldMines) add("goldmines", DECKS.goldmines, mult);
    if (s.dragonAndFairy) add("dragonAndFairy", DECKS.dragonAndFairy, mult);
    if (s.festival) add("festival", DECKS.festival, mult);
    if (s.labyrinth) add("labyrinth", DECKS.labyrinth, mult);
    if (s.river || s.river2) {
      const river1 = s.river ? { ...DECKS.river } : {};
      const river2 = s.river2 ? { ...DECKS.river2 } : {};
      if (s.river2) {
        delete river1.RiverStart;
        delete river1.RiverEnd;
      }
      if (!s.innsAndCathedrals) delete river2.RiverBridgeInn;
      if (s.dragonAndFairy) {
        if (s.river && !s.river2) {
          delete river1.RiverEnd;
          river1.RiverEndDragonDen = 1;
        }
      } else if (s.river2) {
        delete river2.RiverEndDragonDen;
        river2.RiverEnd = 1;
      }
      add("river", river1);
      add("river", river2);
    }
    return deck;
  }

  const label = (id) => id.replace(/([a-z])([A-Z])/g, "$1 $2");

  const images = new Map();
  function loadImage(path) {
    if (!images.has(path)) {
      images.set(path, new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `/textures/${path}`;
      }));
    }
    return images.get(path);
  }

  // Same compositing as the game: overlays are sized relative to the base texture.
  async function drawTile(canvas, id) {
    const [image, overlays = []] = TILES[id] || [];
    if (!image) return;
    const ctx = canvas.getContext("2d");
    try {
      const base = await loadImage(image);
      const parts = await Promise.all(overlays.map(([src, x, y, scale]) => loadImage(src).then((img) => ({ img, x, y, scale }))));
      ctx.drawImage(base, 0, 0, THUMB, THUMB);
      const k = THUMB / Math.max(base.naturalWidth, base.naturalHeight);
      for (const { img, x, y, scale } of parts) {
        ctx.drawImage(img, x * THUMB, y * THUMB, img.naturalWidth * k * scale, img.naturalHeight * k * scale);
      }
    } catch {}
  }

  const ui = (() => {
    const defaults = { x: 16, y: 112, collapsed: window.innerWidth < 700, hideEmpty: false };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
    } catch {
      return defaults;
    }
  })();
  const saveUi = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(ui)); } catch {}
  };

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;z-index:2147483000;top:0;left:0;display:none";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel { width: 296px; max-height: 72vh; display: flex; flex-direction: column; font: 12px/1.3 system-ui, sans-serif;
        color: #f4ead5; background: rgba(28, 22, 16, .94); border: 1px solid #6b5332; border-radius: 10px;
        box-shadow: 0 8px 28px rgba(0,0,0,.45); overflow: hidden; user-select: none; }
      .bar { display: flex; align-items: center; gap: 8px; padding: 7px 8px 7px 10px; cursor: grab; touch-action: none;
        background: linear-gradient(#4a3720, #35281a); border-bottom: 1px solid #6b5332; }
      .bar:active { cursor: grabbing; }
      .grip { opacity: .55; letter-spacing: -2px; }
      .title { font-weight: 600; flex: 1; }
      .total { font-variant-numeric: tabular-nums; color: #f0c45c; font-weight: 700; }
      button { all: unset; cursor: pointer; width: 20px; height: 20px; text-align: center; line-height: 20px; border-radius: 4px; color: #f4ead5; }
      button:hover { background: rgba(255,255,255,.12); }
      button.on { color: #f0c45c; }
      .body { overflow-y: auto; padding: 4px 8px 8px; scrollbar-width: thin; }
      .collapsed .body, .collapsed .foot { display: none; }
      .collapsed .bar { border-bottom: 0; }
      h4 { margin: 8px 0 5px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #c9b48c;
        display: flex; justify-content: space-between; }
      .grid { display: grid; grid-template-columns: repeat(5, ${THUMB}px); gap: 9px 10px; }
      .grid[hidden] { display: none; }
      .tile { position: relative; width: ${THUMB}px; height: ${THUMB}px; }
      .tile canvas { width: ${THUMB}px; height: ${THUMB}px; border-radius: 3px; display: block; }
      .tile .n { position: absolute; right: -5px; bottom: -5px; min-width: 16px; height: 16px; padding: 0 3px; box-sizing: border-box;
        border-radius: 8px; background: #f0c45c; color: #22180c; font-weight: 700; font-size: 11px; line-height: 16px; text-align: center; }
      .tile.out canvas { opacity: .22; filter: grayscale(1); }
      .tile.out .n { background: #5a4a35; color: #c9b48c; }
      .hide-empty .tile.out { display: none; }
      .foot { padding: 5px 10px; border-top: 1px solid #4a3a26; font-size: 11px; color: #a8957a; display: flex; justify-content: space-between; }
      .foot a { color: #f0c45c; text-decoration: none; }
    </style>
    <div class="panel">
      <div class="bar">
        <span class="grip">⋮⋮</span>
        <span class="title">Tiles left</span>
        <span class="total"></span>
        <button class="empty" title="Hide tiles with none left">◐</button>
        <button class="min" title="Collapse"></button>
      </div>
      <div class="body"></div>
      <div class="foot"><span>Drag the bar to move</span><a href="https://tilelord.com" target="_blank" rel="noopener">tilelord.com</a></div>
    </div>`;
  const panel = root.querySelector(".panel");
  const bar = root.querySelector(".bar");
  const body = root.querySelector(".body");
  const totalEl = root.querySelector(".total");
  const minBtn = root.querySelector(".min");
  const emptyBtn = root.querySelector(".empty");

  function applyUi() {
    panel.classList.toggle("collapsed", ui.collapsed);
    panel.classList.toggle("hide-empty", ui.hideEmpty);
    emptyBtn.classList.toggle("on", ui.hideEmpty);
    minBtn.textContent = ui.collapsed ? "▸" : "▾";
    const w = host.offsetWidth || 296;
    const h = host.offsetHeight || 40;
    host.style.left = `${Math.max(0, Math.min(ui.x, window.innerWidth - w))}px`;
    host.style.top = `${Math.max(0, Math.min(ui.y, window.innerHeight - h))}px`;
  }

  minBtn.addEventListener("click", () => { ui.collapsed = !ui.collapsed; applyUi(); saveUi(); });
  emptyBtn.addEventListener("click", () => { ui.hideEmpty = !ui.hideEmpty; applyUi(); saveUi(); });
  window.addEventListener("resize", applyUi);

  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const dx = e.clientX - host.offsetLeft;
    const dy = e.clientY - host.offsetTop;
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      ui.x = ev.clientX - dx;
      ui.y = ev.clientY - dy;
      applyUi();
    };
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
      ui.x = host.offsetLeft;
      ui.y = host.offsetTop;
      saveUi();
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  });

  let deck = null;
  let deckKey = "";
  let cells = new Map();
  let lastSig = "";

  function render(newDeck) {
    deck = newDeck;
    cells = new Map();
    body.textContent = "";
    for (const [section, title] of SECTIONS) {
      if (!deck[section]) continue;
      const h = document.createElement("h4");
      h.innerHTML = `<span>${title}</span><span class="sum"></span>`;
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const id of Object.keys(deck[section])) {
        const cell = document.createElement("div");
        cell.className = "tile";
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = THUMB;
        const n = document.createElement("span");
        n.className = "n";
        cell.append(canvas, n);
        grid.append(cell);
        cells.set(id, { cell, n, section, sum: h.querySelector(".sum") });
        drawTile(canvas, id);
      }
      body.append(h, grid);
    }
  }

  function update() {
    const state = window.tlAgent?.state?.();
    if (!state?.gameId || !state.settings) {
      host.style.display = "none";
      lastSig = "";
      return;
    }
    if (host.style.display === "none") {
      host.style.display = "block";
      applyUi();
    }

    const key = JSON.stringify(state.settings, ["river", "river2", "innsAndCathedrals", "tradersAndBuilders", "goldMines", "dragonAndFairy", "festival", "labyrinth", "tileMultiplier"]);
    if (key !== deckKey) {
      deckKey = key;
      lastSig = "";
      render(buildDeck(state.settings));
    }

    // Tiles already drawn: everything on the board plus what is in my hand.
    const drawn = state.board.map((t) => t.tileId);
    const hand = state.handTiles ? state.handTiles.map((t) => t.id) : state.currentTile ? [state.currentTile.id] : [];
    const pending = state.pendingPlacement;
    if (pending && state.board.some((t) => t.x === pending.pos.x && t.y === pending.pos.y)) {
      const i = hand.indexOf(pending.tile.id);
      if (i >= 0) hand.splice(i, 1);
    }
    drawn.push(...hand);
    const sig = drawn.join(",");
    if (sig === lastSig) return;
    lastSig = sig;

    const left = {};
    for (const section of Object.values(deck)) Object.assign(left, section);
    for (const id of drawn) if (left[id] > 0) left[id]--;

    let total = 0;
    let remaining = 0;
    const sums = new Map();
    for (const [id, { cell, n, section, sum }] of cells) {
      const full = deck[section][id];
      const count = left[id];
      n.textContent = count;
      cell.classList.toggle("out", count === 0);
      cell.title = `${label(id)} — ${count} of ${full} left`;
      total += full;
      remaining += count;
      const s = sums.get(sum) || [0, 0];
      sums.set(sum, [s[0] + count, s[1] + full]);
    }
    for (const [el, [l, f]] of sums) {
      el.textContent = `${l}/${f}`;
      el.parentElement.nextElementSibling.hidden = l === 0;
    }
    totalEl.textContent = `${remaining}/${total}`;
  }

  document.documentElement.append(host);
  setInterval(update, 600);
  update();
})();
