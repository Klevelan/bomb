// Canvas renderer. Based on the original Base44 renderer, extended with map themes,
// character skins and bomb effects from cosmetics.js.
// drawBoard(ctx, size, view, now, meSeat, themeId) where view = { grid, players, bombs, explosions, powerups, anim }.
// drawPreview(ctx, size, kind, id, now) draws a shop thumbnail.
(function () {
  const { COLS, ROWS, WALL, BOX, BLAST_MS, STEP_ANIM, FUSE_MS, COLORS } = window.BombGame;
  const Cos = window.Cosmetics;
  const KIND_COLOR = { speed: '#4C9AFF', bombs: '#FFC53D', blast: '#FF6B4A' };

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, rr); return; }
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function shade(hex, amount) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount * 255));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount * 255));
    const b = Math.max(0, Math.min(255, (n & 255) + amount * 255));
    return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
  }
  function alpha(hex, a) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /* ---------------- Tiles ---------------- */

  function drawFloor(ctx, x, y, cell, T) {
    ctx.fillStyle = (x + y) % 2 === 0 ? T.floorA : T.floorB;
    ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
  }

  function drawWall(ctx, x, y, cell, T) {
    const pad = cell * 0.045;
    roundRect(ctx, x * cell + pad, y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.16);
    ctx.fillStyle = T.wall; ctx.fill();
    ctx.save();
    if (T.glow) { ctx.shadowColor = T.glow; ctx.shadowBlur = cell * 0.3; }
    ctx.strokeStyle = T.wallEdge; ctx.lineWidth = Math.max(1, cell * (T.glow ? 0.05 : 0.035)); ctx.stroke();
    ctx.restore();
  }

  function drawBox(ctx, x, y, cell, T) {
    const px = x * cell, py = y * cell, pad = cell * 0.075, w = cell - pad * 2;
    roundRect(ctx, px + pad, py + pad, w, w, cell * 0.16);
    ctx.fillStyle = T.box; ctx.fill();
    ctx.fillStyle = T.boxTop;
    roundRect(ctx, px + pad + w * 0.12, py + pad + w * 0.12, w * 0.76, w * 0.26, cell * 0.08);
    ctx.fill();
    ctx.strokeStyle = T.boxLine; ctx.lineWidth = Math.max(1, cell * 0.045);
    ctx.beginPath();
    ctx.moveTo(px + cell * 0.5, py + pad + w * 0.4);
    ctx.lineTo(px + cell * 0.5, py + cell - pad);
    ctx.stroke();
  }

  // Floor and walls rarely change (only when the arena closes in), so draw them once
  // per size/theme/layout/wall-change and reuse.
  let bgCache = { key: '', canvas: null };
  function background(size, dpr, T, grid, wallKey) {
    const key = `${size}|${dpr}|${T.id}|${wallKey}`;
    if (bgCache.key === key) return bgCache.canvas;
    const c = document.createElement('canvas');
    c.width = Math.round(size * dpr); c.height = Math.round(size * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const cell = size / COLS;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawFloor(g, x, y, cell, T);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y * COLS + x] === WALL) drawWall(g, x, y, cell, T);
      }
    }
    bgCache = { key, canvas: c };
    return c;
  }

  /* ---------------- Power-ups ---------------- */

  function drawPowerup(ctx, u, cell, now) {
    const cx = (u.x + 0.5) * cell;
    const bob = Math.sin(now / 260 + u.x * 0.9) * cell * 0.05;
    const cy = (u.y + 0.5) * cell + bob;
    const s = cell * 0.6;
    const color = KIND_COLOR[u.kind] || '#ffffff';
    const t = s * 0.5;

    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = cell * 0.7;
    roundRect(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.3);
    ctx.fillStyle = shade(color, -0.56); ctx.fill();
    ctx.restore();

    roundRect(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.3);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, s * 0.1); ctx.stroke();

    ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.4, s * 0.1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (u.kind === 'speed') {
      const k = t * 1.12;
      ctx.beginPath();
      ctx.moveTo(cx + k * 0.2, cy - k * 0.66);
      ctx.lineTo(cx - k * 0.44, cy + k * 0.06);
      ctx.lineTo(cx - k * 0.02, cy + k * 0.06);
      ctx.lineTo(cx - k * 0.22, cy + k * 0.66);
      ctx.lineTo(cx + k * 0.46, cy - k * 0.08);
      ctx.lineTo(cx + k * 0.04, cy - k * 0.08);
      ctx.closePath(); ctx.fill();
    } else if (u.kind === 'bombs') {
      ctx.beginPath(); ctx.arc(cx - t * 0.06, cy + t * 0.14, t * 0.44, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + t * 0.1, cy - t * 0.18);
      ctx.quadraticCurveTo(cx + t * 0.44, cy - t * 0.46, cx + t * 0.16, cy - t * 0.66);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx, cy - t * 0.7);
      ctx.bezierCurveTo(cx + t * 0.56, cy - t * 0.14, cx + t * 0.36, cy + t * 0.54, cx, cy + t * 0.58);
      ctx.bezierCurveTo(cx - t * 0.36, cy + t * 0.54, cx - t * 0.56, cy - t * 0.14, cx, cy - t * 0.7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(color, -0.56);
      ctx.beginPath();
      ctx.moveTo(cx, cy - t * 0.14);
      ctx.bezierCurveTo(cx + t * 0.24, cy + t * 0.12, cx + t * 0.18, cy + t * 0.46, cx, cy + t * 0.5);
      ctx.bezierCurveTo(cx - t * 0.18, cy + t * 0.46, cx - t * 0.24, cy + t * 0.12, cx, cy - t * 0.14);
      ctx.closePath(); ctx.fill();
    }
  }

  /* ---------------- Bombs & blasts ---------------- */

  /* ---------------- Bomb effects ----------------
     Each bomb style draws its own bomb, its own explosion and what the explosion leaves
     behind (a "residue" that fades out after the blast). Particles are worked out from
     the tile position and time, so they look the same on every screen and need no state. */

  const rainbowHue = (now, x, y) => (now / 4 + (x + y) * 25) % 360;
  // Deterministic 0..1 noise for a tile and an index.
  const rnd = (x, y, k) => { const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };
  const RESIDUE_MS = 1100;

  function star(ctx, cx, cy, r, points, inner) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = (i * Math.PI) / points - Math.PI / 2;
      const rr = i % 2 ? r * inner : r;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  // A jagged line from (x1,y1) to (x2,y2) for lightning.
  function bolt(ctx, x1, y1, x2, y2, jitter, seed) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    const n = 5;
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const px = x1 + (x2 - x1) * k, py = y1 + (y2 - y1) * k;
      const off = (rnd(seed, i, 3) - 0.5) * jitter;
      ctx.lineTo(px + -(y2 - y1) / 50 * off, py + (x2 - x1) / 50 * off);
    }
    ctx.lineTo(x2, y2);
  }

  /* ---- bombs ---- */

  function drawBomb(ctx, b, cell, now, fx) {
    const left = Math.max(0, b.left);
    const cx = (b.x + 0.5) * cell, cy = (b.y + 0.5) * cell;
    const pulse = 1 + Math.sin(now / (70 + left * 0.1)) * 0.075;
    const r = cell * 0.32 * pulse;
    const style = fx.id;

    ctx.save();
    ctx.shadowColor = fx.rainbow ? `hsl(${rainbowHue(now, b.x, b.y)}, 100%, 60%)` : `rgba(${fx.blast[1]},0.6)`;
    ctx.shadowBlur = cell * 0.45;

    if (style === 'ice') {
      // Faceted crystal
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.1);
      g.addColorStop(0, '#F4FCFF'); g.addColorStop(0.45, '#8FD3F7'); g.addColorStop(1, '#2C6DA8');
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + Math.PI / 6;
        ctx.lineTo(cx + Math.cos(a) * r * 1.08, cy + Math.sin(a) * r * 1.08);
      }
      ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1, cell * 0.025);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + Math.PI / 6;
        ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r * 1.08, cy + Math.sin(a) * r * 1.08);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.stroke();
      // snowflake spark
      const sx = cx + r * 0.7, sy = cy - r * 0.85, sr = Math.max(2, cell * 0.09);
      ctx.strokeStyle = '#E6FAFF'; ctx.lineWidth = Math.max(1, cell * 0.03); ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3 + now / 500;
        ctx.moveTo(sx - Math.cos(a) * sr, sy - Math.sin(a) * sr); ctx.lineTo(sx + Math.cos(a) * sr, sy + Math.sin(a) * sr);
      }
      ctx.stroke();
      return;
    }

    if (style === 'toxic') {
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#C9FF7A'); g.addColorStop(0.55, '#4FAE2A'); g.addColorStop(1, '#173F0F');
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      // hazard trefoil
      ctx.fillStyle = 'rgba(18,40,10,0.75)';
      for (let i = 0; i < 3; i++) {
        const a = (i * 2 * Math.PI) / 3 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r * 0.62, a - 0.42, a + 0.42);
        ctx.closePath(); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2); ctx.fillStyle = '#B6F24A'; ctx.fill();
      // bubbles rising off the top
      for (let i = 0; i < 3; i++) {
        const k = (now / 700 + i / 3) % 1;
        const bx = cx + (rnd(b.x, b.y, i) - 0.5) * r * 1.2;
        const by = cy - r * 0.6 - k * r * 1.5;
        ctx.beginPath(); ctx.arc(bx, by, r * (0.1 + 0.1 * k), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(190,255,110,${1 - k})`; ctx.lineWidth = Math.max(1, cell * 0.025); ctx.stroke();
      }
      return;
    }

    if (style === 'plasma') {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const flick = 0.85 + 0.15 * Math.sin(now / 40);
      g.addColorStop(0, '#FFF0FF'); g.addColorStop(0.35 * flick, '#E66BFF'); g.addColorStop(1, '#2A0E4A');
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      // orbiting rings with electrons
      ctx.lineWidth = Math.max(1, cell * 0.025);
      for (let i = 0; i < 2; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(now / 380 + (i * Math.PI) / 2);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.25, r * 0.42, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(240,124,255,0.75)'; ctx.stroke();
        const a = now / 150 + i * 2;
        ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.25, Math.sin(a) * r * 0.42, Math.max(1.5, cell * 0.05), 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF'; ctx.fill();
        ctx.restore();
      }
      return;
    }

    if (style === 'gold') {
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#FFF6C8'); g.addColorStop(0.5, '#F2C14E'); g.addColorStop(1, '#9A6614');
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      // moving shine
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      const sweep = ((now / 6) % (r * 6)) - r * 3;
      ctx.translate(cx + sweep, cy); ctx.rotate(0.6);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(-r * 0.12, -r * 2, r * 0.24, r * 4);
      ctx.restore();
      star(ctx, cx, cy, r * 0.42, 5, 0.45);
      ctx.fillStyle = 'rgba(150,95,15,0.6)'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx + r * 0.6, cy - r * 0.8, Math.max(1.6, cell * 0.07), 0, Math.PI * 2);
      ctx.fillStyle = '#FFF2A8'; ctx.fill();
      return;
    }

    // classic & rainbow
    const spark = fx.rainbow ? `hsl(${rainbowHue(now, b.x, b.y)}, 100%, 65%)` : fx.spark;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fx.bomb; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (fx.rainbow && typeof ctx.createConicGradient === 'function') {
      const cg = ctx.createConicGradient(now / 300, cx, cy);
      for (let i = 0; i <= 6; i++) cg.addColorStop(i / 6, `hsl(${i * 60}, 100%, 60%)`);
      ctx.strokeStyle = cg; ctx.lineWidth = Math.max(2, cell * 0.07);
    } else {
      ctx.strokeStyle = fx.rainbow ? spark : fx.rim; ctx.lineWidth = Math.max(1.5, cell * 0.045);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + r * 0.6, cy - r * 0.8, Math.max(1.6, cell * 0.07), 0, Math.PI * 2);
    ctx.fillStyle = spark; ctx.fill();
  }

  /* ---- explosions ---- */

  function blastBase(ctx, cx, cy, s, cell, stops, a) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.78);
    grad.addColorStop(0, `rgba(${stops[0]},${a})`);
    grad.addColorStop(0.45, `rgba(${stops[1]},${a * 0.95})`);
    grad.addColorStop(1, `rgba(${stops[2]},${a * 0.12})`);
    roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.34);
    ctx.fillStyle = grad; ctx.fill();
  }

  function drawBlast(ctx, e, cell, now, fx) {
    const left = Math.max(0, e.left);
    const t = 1 - left / BLAST_MS;       // 0 → 1 over the blast
    const a = Math.max(0, 1 - t * t);    // fade
    const cx = (e.x + 0.5) * cell, cy = (e.y + 0.5) * cell;
    const s = cell * (0.96 + t * 0.18);
    const style = fx.id;

    if (style === 'ice') {
      blastBase(ctx, cx, cy, s, cell, ['240,252,255', '150,215,255', '60,130,230'], a * 0.75);
      // icicle shards bursting out
      const grow = t < 0.22 ? t / 0.22 : 1 - (t - 0.22) * 0.5;
      for (let k = 0; k < 7; k++) {
        // spread evenly around the tile with a little randomness, long and needle-thin
        const ang = ((k + rnd(e.x, e.y, k) * 0.6) / 7) * Math.PI * 2;
        const len = cell * (0.42 + 0.3 * rnd(e.x, e.y, k + 9)) * grow;
        const w = cell * (0.045 + 0.035 * rnd(e.x, e.y, k + 19));
        const tx = cx + Math.cos(ang) * len, ty = cy + Math.sin(ang) * len;
        const px = -Math.sin(ang) * w, py = Math.cos(ang) * w;
        ctx.beginPath();
        ctx.moveTo(cx + px, cy + py); ctx.lineTo(tx, ty); ctx.lineTo(cx - px, cy - py); ctx.closePath();
        const g = ctx.createLinearGradient(cx, cy, tx, ty);
        g.addColorStop(0, `rgba(160,220,255,${a})`); g.addColorStop(1, `rgba(255,255,255,${a})`);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${a * 0.8})`; ctx.lineWidth = Math.max(0.8, cell * 0.015); ctx.stroke();
      }
      for (let k = 0; k < 3; k++) {
        const tw = 0.5 + 0.5 * Math.sin(now / 70 + k * 2);
        star(ctx, cx + (rnd(e.x, e.y, k + 30) - 0.5) * cell * 0.8, cy + (rnd(e.x, e.y, k + 40) - 0.5) * cell * 0.8, cell * 0.08 * tw, 4, 0.3);
        ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fill();
      }
      return;
    }

    if (style === 'toxic') {
      // wobbling goo blob
      const R = cell * (0.3 + 0.28 * Math.min(1, t * 3));
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const ang = (i / 24) * Math.PI * 2;
        const rr = R * (1 + 0.13 * Math.sin(ang * 5 + now / 90 + e.x * 3 + e.y));
        ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.1);
      g.addColorStop(0, `rgba(220,255,140,${a})`); g.addColorStop(0.5, `rgba(110,215,50,${a * 0.95})`); g.addColorStop(1, `rgba(30,110,20,${a * 0.5})`);
      ctx.fillStyle = g; ctx.fill();
      // bubbles rising
      for (let k = 0; k < 5; k++) {
        const bt = (t * 1.4 + rnd(e.x, e.y, k)) % 1;
        const bx = cx + (rnd(e.x, e.y, k + 5) - 0.5) * cell * 0.7;
        const by = cy + cell * 0.25 - bt * cell * 0.65;
        const br = cell * (0.04 + 0.07 * rnd(e.x, e.y, k + 11)) * (0.6 + bt);
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,255,120,${a * 0.35})`; ctx.fill();
        ctx.strokeStyle = `rgba(230,255,170,${a})`; ctx.lineWidth = Math.max(0.8, cell * 0.02); ctx.stroke();
      }
      return;
    }

    if (style === 'plasma') {
      blastBase(ctx, cx, cy, s, cell, ['255,230,255', '210,90,255', '90,30,200'], a * 0.8);
      // crackling lightning, re-rolled every 60 ms
      const roll = Math.floor(now / 60);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let k = 0; k < 3; k++) {
        const ang = rnd(e.x + roll, e.y, k) * Math.PI * 2;
        const len = cell * (0.4 + 0.3 * rnd(e.x, e.y + roll, k));
        bolt(ctx, cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len, cell * 0.6, e.x * 7 + e.y * 13 + roll + k);
        ctx.strokeStyle = `rgba(230,120,255,${a * 0.5})`; ctx.lineWidth = Math.max(2, cell * 0.1); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = Math.max(1, cell * 0.03); ctx.stroke();
      }
      return;
    }

    if (style === 'gold') {
      blastBase(ctx, cx, cy, s, cell, ['255,252,220', '255,214,90', '214,140,20'], a * 0.85);
      for (let k = 0; k < 6; k++) {
        const ang = rnd(e.x, e.y, k) * Math.PI * 2;
        const d = cell * (0.1 + 0.55 * t) * (0.6 + 0.4 * rnd(e.x, e.y, k + 3));
        const px = cx + Math.cos(ang) * d, py = cy + Math.sin(ang) * d;
        ctx.save();
        ctx.translate(px, py); ctx.rotate(now / 200 + k);
        star(ctx, 0, 0, cell * 0.11 * (1 - t * 0.5), 4, 0.35);
        ctx.fillStyle = `rgba(255,245,190,${a})`; ctx.fill();
        ctx.restore();
      }
      return;
    }

    if (style === 'rainbow') {
      const h = rainbowHue(now, e.x, e.y);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.78);
      grad.addColorStop(0, `hsla(${h}, 100%, 92%, ${a})`);
      grad.addColorStop(0.45, `hsla(${h}, 100%, 62%, ${a * 0.95})`);
      grad.addColorStop(1, `hsla(${(h + 40) % 360}, 90%, 50%, ${a * 0.12})`);
      roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.34);
      ctx.fillStyle = grad; ctx.fill();
      for (let k = 0; k < 7; k++) {
        const ang = rnd(e.x, e.y, k) * Math.PI * 2;
        const d = cell * (0.1 + 0.5 * t);
        ctx.save();
        ctx.translate(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d);
        ctx.rotate(now / 120 + k);
        ctx.fillStyle = `hsla(${(k * 52) % 360}, 95%, 62%, ${a})`;
        ctx.fillRect(-cell * 0.05, -cell * 0.025, cell * 0.1, cell * 0.05);
        ctx.restore();
      }
      return;
    }

    blastBase(ctx, cx, cy, s, cell, fx.blast, a);
  }

  /* ---- what's left behind ---- */

  function drawResidue(ctx, r, cell, now, fx) {
    const k = Math.min(1, (now - r.t0) / RESIDUE_MS);
    const a = 1 - k;
    const cx = (r.x + 0.5) * cell, cy = (r.y + 0.5) * cell;
    const style = fx.id;
    if (style === 'ice') {
      const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.55);
      fg.addColorStop(0, `rgba(170,225,255,${0.45 * a})`); fg.addColorStop(1, `rgba(120,200,255,${0.08 * a})`);
      roundRect(ctx, cx - cell * 0.44, cy - cell * 0.44, cell * 0.88, cell * 0.88, cell * 0.24);
      ctx.fillStyle = fg; ctx.fill();
      ctx.strokeStyle = `rgba(200,240,255,${0.35 * a})`; ctx.lineWidth = Math.max(0.8, cell * 0.015); ctx.stroke();
      for (let i = 0; i < 2; i++) {
        const tw = Math.max(0, Math.sin(now / 160 + i * 2.3 + r.x));
        star(ctx, cx + (rnd(r.x, r.y, i + 33) - 0.5) * cell * 0.6, cy + (rnd(r.x, r.y, i + 44) - 0.5) * cell * 0.6, cell * 0.07 * tw, 4, 0.3);
        ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fill();
      }
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * a})`; ctx.lineWidth = Math.max(0.8, cell * 0.018);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const ang = rnd(r.x, r.y, i + 50) * Math.PI * 2;
        const len = cell * (0.2 + 0.18 * rnd(r.x, r.y, i + 60));
        ctx.moveTo(cx, cy);
        const mx = cx + Math.cos(ang) * len * 0.5 + (rnd(r.x, r.y, i) - 0.5) * cell * 0.1;
        const my = cy + Math.sin(ang) * len * 0.5;
        ctx.lineTo(mx, my); ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      }
      ctx.stroke();
    } else if (style === 'toxic') {
      ctx.beginPath();
      ctx.ellipse(cx, cy + cell * 0.08, cell * 0.36 * (1 - k * 0.3), cell * 0.24 * (1 - k * 0.3), 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(110,210,50,${0.5 * a})`; ctx.fill();
      for (let i = 0; i < 2; i++) {
        const p = (now / 500 + i * 0.5 + rnd(r.x, r.y, i)) % 1;
        ctx.beginPath(); ctx.arc(cx + (i ? 0.12 : -0.1) * cell, cy + cell * 0.06, cell * 0.06 * p, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(210,255,150,${a * (1 - p)})`; ctx.lineWidth = Math.max(0.8, cell * 0.02); ctx.stroke();
      }
    } else if (style === 'plasma') {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.45);
      g.addColorStop(0, `rgba(160,60,220,${0.35 * a})`); g.addColorStop(1, 'rgba(160,60,220,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
      if (Math.floor(now / 90) % 4 === 0) {
        const seed = Math.floor(now / 90);
        bolt(ctx, cx - cell * 0.25, cy, cx + cell * 0.25, cy + (rnd(r.x, seed, 1) - 0.5) * cell * 0.3, cell * 0.4, seed);
        ctx.strokeStyle = `rgba(240,180,255,${a})`; ctx.lineWidth = Math.max(0.8, cell * 0.02); ctx.stroke();
      }
    } else if (style === 'gold') {
      for (let i = 0; i < 4; i++) {
        const tw = Math.max(0, Math.sin(now / 150 + i * 1.7));
        star(ctx, cx + (rnd(r.x, r.y, i + 70) - 0.5) * cell * 0.8, cy + (rnd(r.x, r.y, i + 80) - 0.5) * cell * 0.8, cell * 0.07 * tw, 4, 0.3);
        ctx.fillStyle = `rgba(255,225,120,${a})`; ctx.fill();
      }
    } else if (style === 'rainbow') {
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.translate(cx + (rnd(r.x, r.y, i + 90) - 0.5) * cell * 0.8, cy + (rnd(r.x, r.y, i + 95) - 0.5) * cell * 0.8);
        ctx.rotate(rnd(r.x, r.y, i) * 6);
        ctx.fillStyle = `hsla(${(i * 60) % 360}, 90%, 60%, ${a})`;
        ctx.fillRect(-cell * 0.045, -cell * 0.022, cell * 0.09, cell * 0.044);
        ctx.restore();
      }
    } else {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.45);
      g.addColorStop(0, `rgba(0,0,0,${0.35 * a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
    }
  }

  // Remember explosions between frames so a residue can appear where one just ended.
  let lastBlasts = new Map();
  let residues = [];
  function trackResidues(blasts, players, now, grid) {
    const live = new Map();
    for (const e of blasts) live.set(e.x + ',' + e.y, e);
    for (const [key, e] of lastBlasts) {
      if (!live.has(key)) residues.push({ x: e.x, y: e.y, fx: fxFor(players, e.owner), t0: now });
    }
    lastBlasts = live;
    residues = residues.filter((r) => now - r.t0 < RESIDUE_MS && grid[r.y * COLS + r.x] !== WALL);
  }

  /* ---------------- Players ---------------- */

  function ghostPath(ctx, cx, cy, r, now) {
    ctx.beginPath();
    ctx.moveTo(cx - r, cy + r * 0.78);
    ctx.lineTo(cx - r, cy - r * 0.05);
    ctx.arc(cx, cy - r * 0.05, r, Math.PI, 0);
    ctx.lineTo(cx + r, cy + r * 0.78);
    const w = (r * 2) / 3, ph = Math.sin(now / 180) * r * 0.1;
    for (let i = 0; i < 3; i++) {
      const x0 = cx + r - i * w;
      ctx.quadraticCurveTo(x0 - w / 2, cy + r * 1.12 + (i % 2 ? ph : -ph), x0 - w, cy + r * 0.78);
    }
    ctx.closePath();
  }

  function drawEyes(ctx, skin, cx, cy, r, look) {
    const ex = look[0] * r, ey = look[1] * r;
    const style = skin.eyes || 'dots';
    if (style === 'visor') {
      roundRect(ctx, cx - r * 0.66, cy - r * 0.36, r * 1.32, r * 0.42, r * 0.2);
      ctx.fillStyle = '#18202C'; ctx.fill();
      ctx.save();
      ctx.shadowColor = '#38E1FF'; ctx.shadowBlur = r * 0.5;
      roundRect(ctx, cx - r * 0.24 + ex * 0.9, cy - r * 0.26, r * 0.48, r * 0.2, r * 0.1);
      ctx.fillStyle = '#5FF0FF'; ctx.fill();
      ctx.restore();
      return;
    }
    if (style === 'band') {
      ctx.fillStyle = skin.band;
      ctx.fillRect(cx - r, cy - r * 0.36, r * 2, r * 0.42);
      ctx.fillStyle = '#F4F6FA';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + side * r * 0.34 + ex * 0.6, cy - r * 0.15, r * 0.15, r * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    ctx.fillStyle = 'rgba(10,14,20,0.78)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + side * r * 0.34 + ex, cy - r * 0.12 + ey, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    if (style === 'angry') {
      ctx.strokeStyle = 'rgba(10,14,20,0.85)'; ctx.lineWidth = r * 0.12; ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.58 + ex, cy - r * 0.46 + ey);
        ctx.lineTo(cx + side * r * 0.16 + ex, cy - r * 0.32 + ey);
        ctx.stroke();
      }
    }
  }

  function drawExtras(ctx, skin, cx, cy, r, now, layer, base) {
    const x = skin.extra;
    if (!x) return;
    if (layer === 'body') {
      if (x === 'shine') {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.ellipse(cx - r * 0.45, cy - r * 0.55, r * 0.28, r * 0.14, -0.5, 0, Math.PI * 2); ctx.fill();
      } else if (x === 'spots') {
        ctx.fillStyle = alpha(base, 0.55);
        for (const [dx, dy, s] of [[-0.55, 0.45, 0.16], [0.5, 0.55, 0.12], [0.62, -0.62, 0.1], [-0.1, 0.72, 0.09]]) {
          ctx.beginPath(); ctx.arc(cx + dx * r, cy + dy * r, s * r, 0, Math.PI * 2); ctx.fill();
        }
      } else if (x === 'stars') {
        for (const [dx, dy, ph] of [[-0.6, 0.5, 0], [0.55, 0.45, 1.3], [0.15, 0.7, 2.1], [-0.25, -0.65, 3], [0.68, -0.55, 4.2], [-0.72, -0.2, 5]]) {
          ctx.fillStyle = `rgba(255,255,255,${0.45 + 0.5 * Math.abs(Math.sin(now / 400 + ph))})`;
          ctx.beginPath(); ctx.arc(cx + dx * r, cy + dy * r, r * 0.06, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (layer === 'top') {
      if (x === 'antenna') {
        ctx.strokeStyle = '#7D8794'; ctx.lineWidth = r * 0.1; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - r * 1.42); ctx.stroke();
        ctx.fillStyle = Math.floor(now / 500) % 2 ? '#FF5D73' : '#FF9AA8';
        ctx.beginPath(); ctx.arc(cx, cy - r * 1.48, r * 0.15, 0, Math.PI * 2); ctx.fill();
      } else if (x === 'crown') {
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.58, cy - r * 0.88);
        ctx.lineTo(cx - r * 0.62, cy - r * 1.45);
        ctx.lineTo(cx - r * 0.3, cy - r * 1.15);
        ctx.lineTo(cx, cy - r * 1.6);
        ctx.lineTo(cx + r * 0.3, cy - r * 1.15);
        ctx.lineTo(cx + r * 0.62, cy - r * 1.45);
        ctx.lineTo(cx + r * 0.58, cy - r * 0.88);
        ctx.closePath();
        ctx.fillStyle = '#FFD54A'; ctx.fill();
        ctx.strokeStyle = '#B9821A'; ctx.lineWidth = r * 0.07; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.fillStyle = '#E5484D';
        ctx.beginPath(); ctx.arc(cx, cy - r * 1.08, r * 0.09, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Where a player is drawn right now (smoothly between tiles while stepping).
  function playerPos(p, anim, now) {
    const a = anim && anim[p.seat];
    if (!a || !a.from) return { x: p.x, y: p.y };
    const k = Math.min(1, (now - a.t0) / STEP_ANIM);
    const e = 1 - Math.pow(1 - k, 3);
    return { x: a.from.x + (p.x - a.from.x) * e, y: a.from.y + (p.y - a.from.y) * e };
  }

  function drawPlayer(ctx, p, cell, now, meSeat, anim) {
    const { x: gx, y: gy } = playerPos(p, anim, now);
    const cx = (gx + 0.5) * cell, cy = (gy + 0.5) * cell, r = cell * 0.32;
    const skin = Cos.byId('skin', p.skin);
    const top = skin.body ? skin.body[0] : shade(p.color, 0.08);
    const bottom = skin.body ? skin.body[1] : shade(p.color, -0.22);

    ctx.save();
    if (!p.alive) ctx.globalAlpha = 0.2;

    if (p.seat === meSeat) {
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.62, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(1.5, cell * 0.04); ctx.stroke();
    }

    // Shadow in the seat colour, so players stay easy to tell apart whatever skin they wear.
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.98, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fillStyle = alpha(p.color, 0.55); ctx.fill();

    const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.save();
    if (skin.alpha && p.alive) ctx.globalAlpha *= skin.alpha;
    if (skin.shape === 'ghost') ghostPath(ctx, cx, cy, r, now);
    else roundRect(ctx, cx - r, cy - r, r * 2, r * 2, r * 0.52);
    ctx.fillStyle = grad; ctx.fill();
    ctx.clip();
    drawExtras(ctx, skin, cx, cy, r, now, 'body', bottom.startsWith('#') ? bottom : '#000000');
    ctx.restore();

    if (p.alive) {
      const look = { up: [0, -0.22], down: [0, 0.16], left: [-0.22, 0.04], right: [0.22, 0.04] }[p.facing] || [0, 0.12];
      drawEyes(ctx, skin, cx, cy, r, look);
    } else {
      ctx.strokeStyle = 'rgba(12,16,21,0.9)'; ctx.lineWidth = Math.max(1.5, cell * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.4, cy - r * 0.4); ctx.lineTo(cx + r * 0.4, cy + r * 0.4);
      ctx.moveTo(cx + r * 0.4, cy - r * 0.4); ctx.lineTo(cx - r * 0.4, cy + r * 0.4);
      ctx.stroke();
    }
    drawExtras(ctx, skin, cx, cy, r, now, 'top');
    ctx.restore();
  }

  /* ---------------- Board ---------------- */

  function fxFor(players, owner) {
    const p = players && players[owner];
    return Cos.byId('bomb', p ? p.bombFx : 'classic');
  }

  // cam = { x, y, zoom }: the tile position to centre on (x, y) and how far to zoom in.
  // The view never scrolls past the arena edges.
  const MAX_ZOOM = 1.6;
  function drawBoard(ctx, size, view, now, meSeat, themeId, cam) {
    const T = Cos.byId('map', themeId);
    const zoom = cam ? Math.max(1, Math.min(MAX_ZOOM, cam.zoom)) : 1;
    const cell = (size * zoom) / COLS;
    const vis = COLS / zoom; // tiles visible across
    const clampView = (c) => Math.max(0, Math.min(COLS - vis, c - vis / 2));
    const ox = cam ? clampView(cam.x) * cell : 0;
    const oy = cam ? clampView(cam.y) * cell : 0;
    const dpr = ctx.getTransform ? ctx.getTransform().a : 1;
    ctx.clearRect(0, 0, size, size);
    if (!view || !view.grid) {
      const c = size / COLS;
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawFloor(ctx, x, y, c, T);
      return;
    }

    const blasts = view.explosions || [];
    const shake = Math.min(1, blasts.length / 9) * cell * 0.16;
    ctx.save();
    if (shake > 0.3) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.translate(-ox, -oy);

    // The cached floor/walls are drawn once at full zoom resolution and scaled down as needed.
    const bg = background(Math.round(size * MAX_ZOOM), dpr, T, view.grid, `${view.layout}|${view.wallVer || 0}|${view.round || ''}`);
    ctx.drawImage(bg, 0, 0, COLS * cell, ROWS * cell);
    // Warning on the tiles the closing walls fill next.
    if (view.shrinkNext && view.shrinkNext.length) {
      const pulse = 0.35 + 0.25 * Math.sin(now / 90);
      view.shrinkNext.forEach((k, i) => {
        const x = k % COLS, y = (k / COLS) | 0;
        ctx.fillStyle = `rgba(255,60,60,${pulse * (1 - i / view.shrinkNext.length * 0.6)})`;
        roundRect(ctx, x * cell + cell * 0.06, y * cell + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.16);
        ctx.fill();
      });
    }
    const players = view.players || [];
    trackResidues(blasts, players, now, view.grid);
    for (const r of residues) drawResidue(ctx, r, cell, now, r.fx);
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (view.grid[y * COLS + x] === BOX) drawBox(ctx, x, y, cell, T);
      }
    }
    for (const u of view.powerups || []) drawPowerup(ctx, u, cell, now);
    for (const b of view.bombs || []) drawBomb(ctx, b, cell, now, fxFor(players, b.owner));
    for (const e of blasts) drawBlast(ctx, e, cell, now, fxFor(players, e.owner));
    for (const p of players) drawPlayer(ctx, p, cell, now, meSeat, view.anim || {});
    ctx.restore();

    if (blasts.length) {
      // Screen flash in the colour of the most recent explosion's bomb style.
      const fx = fxFor(players, blasts[blasts.length - 1].owner);
      const rgb = fx.rainbow ? '255,200,120' : fx.blast[1];
      ctx.fillStyle = `rgba(${rgb},${Math.min(0.14, blasts.length * 0.012)})`;
      ctx.fillRect(0, 0, size, size);
    }
  }

  /* ---------------- Shop previews ---------------- */

  function drawPreview(ctx, size, kind, id, now) {
    ctx.clearRect(0, 0, size, size);
    if (kind === 'map') {
      const T = Cos.byId('map', id);
      const n = 5, cell = size / n;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          drawFloor(ctx, x, y, cell, T);
          if (x === 0 || y === 0 || x === n - 1 || y === n - 1 || (x === 2 && y === 2)) drawWall(ctx, x, y, cell, T);
        }
      }
      drawBox(ctx, 3, 1, cell, T);
      drawBox(ctx, 1, 3, cell, T);
      drawBox(ctx, 3, 2, cell, T);
      drawPlayer(ctx, { seat: 0, x: 1, y: 1, color: COLORS[0], alive: true, facing: 'down', skin: 'classic' }, cell, now, -1, {});
      return;
    }
    const T = Cos.byId('map', 'dungeon');
    const n = 3, cell = size / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) drawFloor(ctx, x, y, cell, T);
    if (kind === 'skin') {
      const facing = ['down', 'right', 'down', 'left'][Math.floor(now / 900) % 4];
      // draw larger than in-game so details show
      ctx.save();
      ctx.translate(size / 2, size / 2 + size * 0.05);
      ctx.scale(1.55, 1.55);
      ctx.translate(-size / 2, -size / 2);
      drawPlayer(ctx, { seat: 0, x: 1, y: 1, color: COLORS[0], alive: true, facing, skin: id }, cell, now, -1, {});
      ctx.restore();
    } else {
      // Loop: bomb (1.2 s) → explosion → what it leaves behind.
      const fx = Cos.byId('bomb', id);
      const cross = [[1, 1], [0, 1], [2, 1], [1, 0], [1, 2]];
      const t = now % 2900;
      if (t < 1200) {
        ctx.save();
        ctx.translate(size / 2, size / 2); ctx.scale(1.4, 1.4); ctx.translate(-size / 2, -size / 2);
        drawBomb(ctx, { x: 1, y: 1, left: FUSE_MS * (1 - t / 1200) }, cell, now, fx);
        ctx.restore();
      } else if (t < 1200 + BLAST_MS * 1.3) {
        const left = BLAST_MS * (1 - (t - 1200) / (BLAST_MS * 1.3));
        for (const [x, y] of cross) drawBlast(ctx, { x, y, left }, cell, now, fx);
      } else {
        const t0 = now - (t - 1200 - BLAST_MS * 1.3);
        for (const [x, y] of cross) drawResidue(ctx, { x, y, t0 }, cell, now, fx);
      }
    }
  }

  window.drawBoard = drawBoard;
  window.playerPos = playerPos;
  window.drawPreview = drawPreview;
  window.KIND_COLOR = KIND_COLOR;
  window.skinColor = (p) => { const s = Cos.byId('skin', p.skin); return s.body ? s.body[0] : p.color; };
})();
