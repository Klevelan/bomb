// Bomb Room game rules. Shared by the browser (offline modes) and the Node server (online rooms).
// No DOM, no network: just state in, state out.
(function (root) {
  const COLS = 19, ROWS = 19, N = COLS * ROWS;
  const FLOOR = 0, WALL = 1, BOX = 2;
  const BLAST_MS = 480;
  const STEP_ANIM = 150;
  const FUSE_MS = 2400;
  const BOX_DENSITY = 0.72;
  const DROP_CHANCE = 0.32;
  const MAX_PLAYERS = 4;

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DIR_LIST = ['up', 'down', 'left', 'right'];
  const COLORS = ['#4C9AFF', '#FF5D73', '#3DDC97', '#C38BFF'];
  const SPAWNS = [[1, 1], [COLS - 2, ROWS - 2], [COLS - 2, 1], [1, ROWS - 2]];
  const LIMITS = { speed: 4, bombs: 6, blast: 8 };
  const KINDS = ['speed', 'bombs', 'blast'];

  // Bot tuning: think = ms between decisions, mistake = chance of a random step,
  // hunt = whether bots deliberately bomb other players.
  const DIFF = {
    easy:   { think: 380, mistake: 0.22, hunt: false },
    medium: { think: 200, mistake: 0.06, hunt: true },
    hard:   { think: 90,  mistake: 0,    hunt: true },
  };

  const idx = (x, y) => y * COLS + x;

  function makeGrid() {
    const g = new Uint8Array(N);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0)) {
          g[idx(x, y)] = WALL;
        } else if (!SPAWNS.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) <= 2) && Math.random() < BOX_DENSITY) {
          g[idx(x, y)] = BOX;
        }
      }
    }
    return g;
  }

  // seats: [{ name, isBot }] in seat order (max 4). mode: 'solo' | 'local' | 'online'.
  function createGame({ mode, difficulty, seats, now }) {
    if (!DIFF[difficulty]) difficulty = 'medium';
    const players = seats.slice(0, MAX_PLAYERS).map((s, i) => ({
      seat: i,
      name: s.name,
      color: COLORS[i],
      x: SPAWNS[i][0], y: SPAWNS[i][1],
      alive: true, facing: 'down',
      speed: 0, maxBombs: 1, range: 2,
      lastMove: -1e9, nextThink: 0,
      isBot: !!s.isBot,
      input: null, // held direction for humans
    }));
    return {
      mode, difficulty, grid: makeGrid(), players,
      bombs: [], explosions: [], powerups: [], anim: {},
      status: 'ready', readyUntil: now + 1800, goUntil: 0, endAt: 0, winner: null,
    };
  }

  const moveCooldown = (p) => Math.max(80, 170 - p.speed * 22);
  const bombAt = (G, x, y) => G.bombs.find((b) => b.x === x && b.y === y);
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
  const walkable = (G, x, y) => inBounds(x, y) && G.grid[idx(x, y)] === FLOOR && !bombAt(G, x, y);
  const activeBombs = (G, p) => G.bombs.reduce((n, b) => n + (b.owner === p.seat ? 1 : 0), 0);

  function applyPowerup(p, kind) {
    if (kind === 'speed') p.speed = Math.min(LIMITS.speed, p.speed + 1);
    else if (kind === 'bombs') p.maxBombs = Math.min(LIMITS.bombs, p.maxBombs + 1);
    else p.range = Math.min(LIMITS.blast, p.range + 1);
  }

  function tryMove(G, p, dir, now) {
    if (!p.alive || G.status !== 'playing' || !DIRS[dir]) return false;
    p.facing = dir;
    if (now - p.lastMove < moveCooldown(p)) return false;
    const [dx, dy] = DIRS[dir];
    const nx = p.x + dx, ny = p.y + dy;
    if (!walkable(G, nx, ny)) return false;
    G.anim[p.seat] = { from: { x: p.x, y: p.y }, t0: now };
    p.x = nx; p.y = ny; p.lastMove = now;
    const k = G.powerups.findIndex((u) => u.x === nx && u.y === ny);
    if (k >= 0) { applyPowerup(p, G.powerups[k].kind); G.powerups.splice(k, 1); }
    return true;
  }

  function placeBomb(G, p) {
    if (!p || !p.alive || G.status !== 'playing') return false;
    if (bombAt(G, p.x, p.y) || activeBombs(G, p) >= p.maxBombs) return false;
    G.bombs.push({ x: p.x, y: p.y, owner: p.seat, range: p.range, left: FUSE_MS });
    return true;
  }

  function addBlast(G, x, y, drop) {
    const e = G.explosions.find((e) => e.x === x && e.y === y);
    if (e) { e.left = BLAST_MS; if (drop) e.drop = drop; }
    else G.explosions.push({ x, y, left: BLAST_MS, drop: drop || null });
    const k = G.powerups.findIndex((u) => u.x === x && u.y === y);
    if (k >= 0) G.powerups.splice(k, 1);
    const b = bombAt(G, x, y);
    if (b && b.left > 0) b.left = 0; // chain reaction
  }

  function detonate(G, b) {
    G.bombs.splice(G.bombs.indexOf(b), 1);
    addBlast(G, b.x, b.y);
    for (const d of DIR_LIST) {
      const [dx, dy] = DIRS[d];
      for (let i = 1; i <= b.range; i++) {
        const x = b.x + dx * i, y = b.y + dy * i;
        const v = G.grid[idx(x, y)];
        if (v === WALL) break;
        if (v === BOX) {
          G.grid[idx(x, y)] = FLOOR;
          addBlast(G, x, y, Math.random() < DROP_CHANCE ? KINDS[(Math.random() * 3) | 0] : null);
          break;
        }
        const hitBomb = !!bombAt(G, x, y);
        addBlast(G, x, y);
        if (hitBomb) break;
      }
    }
  }

  // Advance the game by dt ms. Humans move in the direction stored in player.input.
  function step(G, dt, now) {
    if (G.status === 'ready') {
      if (now < G.readyUntil) return;
      G.status = 'playing';
      G.goUntil = now + 600;
    }
    if (G.status === 'over') return;

    if (G.status === 'playing') {
      for (const p of G.players) {
        if (!p.alive) continue;
        if (p.isBot) {
          if (now >= p.nextThink && now - p.lastMove >= moveCooldown(p)) {
            botThink(G, p, now);
            p.nextThink = now + DIFF[G.difficulty].think * (0.7 + Math.random() * 0.6);
          }
        } else if (p.input) {
          tryMove(G, p, p.input, now);
        }
      }
    }

    for (const b of G.bombs) b.left -= dt;
    let due;
    while ((due = G.bombs.find((b) => b.left <= 0))) detonate(G, due);

    for (const e of G.explosions) e.left -= dt;
    G.explosions = G.explosions.filter((e) => {
      if (e.left > 0) return true;
      if (e.drop && G.grid[idx(e.x, e.y)] === FLOOR) G.powerups.push({ x: e.x, y: e.y, kind: e.drop });
      return false;
    });

    for (const p of G.players) {
      if (p.alive && G.explosions.some((e) => e.x === p.x && e.y === p.y)) p.alive = false;
    }

    const alive = G.players.filter((p) => p.alive);
    const humans = G.players.filter((p) => !p.isBot);
    if (G.status === 'playing') {
      const noHumansLeft = humans.length > 0 && !humans.some((p) => p.alive);
      if (alive.length <= 1 || noHumansLeft) { G.status = 'ending'; G.endAt = now + 900; }
    } else if (G.status === 'ending' && now >= G.endAt) {
      G.status = 'over';
      G.winner = alive.length === 1 ? alive[0].seat : null;
    }
  }

  // Remove a player from a running match (e.g. they left the room).
  function forfeit(G, seat) {
    const p = G.players[seat];
    if (p) { p.alive = false; p.input = null; }
  }

  // Compact, JSON-friendly view of the game for sending to clients. Times are relative ms.
  function snapshot(G, now) {
    return {
      status: G.status,
      difficulty: G.difficulty,
      readyIn: Math.max(0, Math.round(G.readyUntil - now)),
      goIn: Math.max(0, Math.round(G.goUntil - now)),
      winner: G.winner,
      players: G.players.map((p) => ({
        seat: p.seat, name: p.name, color: p.color, x: p.x, y: p.y, alive: p.alive, facing: p.facing,
        speed: p.speed, maxBombs: p.maxBombs, range: p.range, isBot: p.isBot,
      })),
      bombs: G.bombs.map((b) => ({ x: b.x, y: b.y, owner: b.owner, left: Math.round(b.left) })),
      explosions: G.explosions.map((e) => ({ x: e.x, y: e.y, left: Math.round(e.left) })),
      powerups: G.powerups.map((u) => ({ x: u.x, y: u.y, kind: u.kind })),
    };
  }
  const gridString = (G) => G.grid.join('');

  /* ---------- Bots ---------- */

  // For each tile: ms until it is hit by a blast (Infinity = safe). Accounts for chain reactions.
  function dangerMap(G, bombs) {
    const d = new Float64Array(N).fill(Infinity);
    for (const e of G.explosions) d[idx(e.x, e.y)] = 0;
    for (let pass = 0; pass < 3; pass++) {
      for (const b of bombs) {
        const c = idx(b.x, b.y);
        const t = Math.min(b.left, d[c]);
        if (t < d[c]) d[c] = t;
        for (const dir of DIR_LIST) {
          const [dx, dy] = DIRS[dir];
          for (let i = 1; i <= b.range; i++) {
            const x = b.x + dx * i, y = b.y + dy * i, k = idx(x, y), v = G.grid[k];
            if (v === WALL) break;
            if (t < d[k]) d[k] = t;
            if (v === BOX || bombs.some((o) => o.x === x && o.y === y)) break;
          }
        }
      }
    }
    return d;
  }

  // BFS from the bot. strict = only fully safe tiles; otherwise allow passing through tiles
  // that won't blow up while the bot is standing on them.
  function bfs(G, p, danger, cd, strict) {
    const dist = new Int32Array(N).fill(-1);
    const first = new Array(N).fill(null);
    const s = idx(p.x, p.y);
    dist[s] = 0;
    const order = [s];
    for (let h = 0; h < order.length; h++) {
      const c = order[h], cx = c % COLS, cy = (c / COLS) | 0;
      for (const dir of DIR_LIST) {
        const [dx, dy] = DIRS[dir];
        const nx = cx + dx, ny = cy + dy, n = idx(nx, ny);
        if (dist[n] !== -1 || !walkable(G, nx, ny)) continue;
        const arrive = (dist[c] + 1) * cd;
        if (strict ? danger[n] !== Infinity : danger[n] <= arrive + cd + 120) continue;
        dist[n] = dist[c] + 1;
        first[n] = c === s ? dir : first[c];
        order.push(n);
      }
    }
    return { dist, first, order };
  }

  function bombValue(G, p, x, y, cfg) {
    let v = 0;
    for (const dir of DIR_LIST) {
      const [dx, dy] = DIRS[dir];
      for (let i = 1; i <= p.range; i++) {
        const tx = x + dx * i, ty = y + dy * i, g = G.grid[idx(tx, ty)];
        if (g === WALL) break;
        if (g === BOX) { v += 1; break; }
        if (cfg.hunt && G.players.some((o) => o !== p && o.alive && o.x === tx && o.y === ty)) v += 3;
      }
    }
    return v;
  }

  function canEscape(G, p, cd) {
    const bombs = [...G.bombs, { x: p.x, y: p.y, range: p.range, left: FUSE_MS, owner: p.seat }];
    const d = dangerMap(G, bombs);
    const r = bfs(G, p, d, cd, false);
    return r.order.some((i) => d[i] === Infinity && r.dist[i] <= 10);
  }

  function botThink(G, p, now) {
    const cfg = DIFF[G.difficulty];
    const cd = moveCooldown(p);
    const danger = dangerMap(G, G.bombs);
    const here = idx(p.x, p.y);

    // 1. In a blast path: run to the nearest safe tile.
    if (danger[here] !== Infinity) {
      const r = bfs(G, p, danger, cd, false);
      const target = r.order.find((i) => i !== here && danger[i] === Infinity);
      if (target !== undefined) { tryMove(G, p, r.first[target], now); return; }
      let best = null, bt = danger[here];
      for (const i of r.order) if (i !== here && danger[i] > bt) { bt = danger[i]; best = i; }
      if (best !== null) tryMove(G, p, r.first[best], now);
      return;
    }

    const safeSteps = DIR_LIST.filter((d) => {
      const [dx, dy] = DIRS[d];
      return walkable(G, p.x + dx, p.y + dy) && danger[idx(p.x + dx, p.y + dy)] === Infinity;
    });

    // 2. Occasional fumble (easier bots).
    if (Math.random() < cfg.mistake) {
      if (safeSteps.length) tryMove(G, p, safeSteps[(Math.random() * safeSteps.length) | 0], now);
      return;
    }

    // 3. Bomb here if it hits something and there's a way out.
    const canBomb = activeBombs(G, p) < p.maxBombs && !bombAt(G, p.x, p.y);
    if (canBomb && bombValue(G, p, p.x, p.y, cfg) > 0 && canEscape(G, p, cd)) {
      placeBomb(G, p);
      return;
    }

    // 4. Walk toward a power-up, a good bombing spot, or an enemy.
    const r = bfs(G, p, danger, cd, true);
    let goal = r.order.find((i) => i !== here && r.dist[i] <= 8 && G.powerups.some((u) => idx(u.x, u.y) === i));
    if (goal === undefined && canBomb) {
      goal = r.order.find((i) => i !== here && bombValue(G, p, i % COLS, (i / COLS) | 0, cfg) > 0);
    }
    if (goal === undefined && cfg.hunt) {
      const enemies = G.players.filter((o) => o !== p && o.alive);
      let bd = Infinity;
      for (const i of r.order) {
        const x = i % COLS, y = (i / COLS) | 0;
        const md = Math.min(...enemies.map((o) => Math.abs(o.x - x) + Math.abs(o.y - y)));
        if (md < bd) { bd = md; goal = i; }
      }
      if (goal === here) goal = undefined;
    }
    if (goal !== undefined) tryMove(G, p, r.first[goal], now);
    else if (safeSteps.length) tryMove(G, p, safeSteps[(Math.random() * safeSteps.length) | 0], now);
  }

  const api = {
    COLS, ROWS, FLOOR, WALL, BOX, BLAST_MS, STEP_ANIM, FUSE_MS, MAX_PLAYERS, DIRS, COLORS, DIFF,
    createGame, step, tryMove, placeBomb, forfeit, snapshot, gridString, activeBombs,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BombGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
