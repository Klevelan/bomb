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

  // Floor and walls never change during a match, so draw them once per size/theme and reuse.
  let bgCache = { key: '', canvas: null };
  function background(size, dpr, T) {
    const key = `${size}|${dpr}|${T.id}`;
    if (bgCache.key === key) return bgCache.canvas;
    const c = document.createElement('canvas');
    c.width = Math.round(size * dpr); c.height = Math.round(size * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const cell = size / COLS;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawFloor(g, x, y, cell, T);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0)) drawWall(g, x, y, cell, T);
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

  const rainbowHue = (now, x, y) => (now / 4 + (x + y) * 25) % 360;

  function drawBomb(ctx, b, cell, now, fx) {
    const left = Math.max(0, b.left);
    const cx = (b.x + 0.5) * cell, cy = (b.y + 0.5) * cell;
    const pulse = 1 + Math.sin(now / (70 + left * 0.1)) * 0.075;
    const r = cell * 0.32 * pulse;
    const spark = fx.rainbow ? `hsl(${rainbowHue(now, b.x, b.y)}, 100%, 65%)` : fx.spark;

    ctx.save();
    ctx.shadowColor = fx.rainbow ? spark : `rgba(${fx.blast[1]},0.55)`;
    ctx.shadowBlur = cell * 0.4;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fx.bomb; ctx.fill();
    ctx.restore();

    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = fx.rainbow ? spark : fx.rim; ctx.lineWidth = Math.max(1.5, cell * 0.045); ctx.stroke();

    ctx.beginPath(); ctx.arc(cx + r * 0.6, cy - r * 0.8, Math.max(1.6, cell * 0.07), 0, Math.PI * 2);
    ctx.fillStyle = spark; ctx.fill();
  }

  function drawBlast(ctx, e, cell, now, fx) {
    const left = Math.max(0, e.left);
    const t = 1 - left / BLAST_MS;
    const a = Math.max(0, 1 - t * t);
    const cx = (e.x + 0.5) * cell, cy = (e.y + 0.5) * cell;
    const s = cell * (0.96 + t * 0.18);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.78);
    if (fx.rainbow) {
      const h = rainbowHue(now, e.x, e.y);
      grad.addColorStop(0, `hsla(${h}, 100%, 92%, ${a})`);
      grad.addColorStop(0.45, `hsla(${h}, 100%, 62%, ${a * 0.95})`);
      grad.addColorStop(1, `hsla(${(h + 40) % 360}, 90%, 50%, ${a * 0.12})`);
    } else {
      grad.addColorStop(0, `rgba(${fx.blast[0]},${a})`);
      grad.addColorStop(0.45, `rgba(${fx.blast[1]},${a * 0.95})`);
      grad.addColorStop(1, `rgba(${fx.blast[2]},${a * 0.12})`);
    }
    roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.34);
    ctx.fillStyle = grad; ctx.fill();
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

  function drawPlayer(ctx, p, cell, now, meSeat, anim) {
    let gx = p.x, gy = p.y;
    const a = anim[p.seat];
    if (a && a.from) {
      const k = Math.min(1, (now - a.t0) / STEP_ANIM);
      const e = 1 - Math.pow(1 - k, 3);
      gx = a.from.x + (p.x - a.from.x) * e;
      gy = a.from.y + (p.y - a.from.y) * e;
    }
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

  function drawBoard(ctx, size, view, now, meSeat, themeId) {
    const T = Cos.byId('map', themeId);
    const cell = size / COLS;
    const dpr = ctx.getTransform ? ctx.getTransform().a : 1;
    ctx.clearRect(0, 0, size, size);
    if (!view || !view.grid) {
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawFloor(ctx, x, y, cell, T);
      return;
    }

    const blasts = view.explosions || [];
    const shake = Math.min(1, blasts.length / 9) * cell * 0.16;
    ctx.save();
    if (shake > 0.3) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    ctx.drawImage(background(size, dpr, T), 0, 0, size, size);
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (view.grid[y * COLS + x] === BOX) drawBox(ctx, x, y, cell, T);
      }
    }
    const players = view.players || [];
    for (const u of view.powerups || []) drawPowerup(ctx, u, cell, now);
    for (const b of view.bombs || []) drawBomb(ctx, b, cell, now, fxFor(players, b.owner));
    for (const e of blasts) drawBlast(ctx, e, cell, now, fxFor(players, e.owner));
    for (const p of players) drawPlayer(ctx, p, cell, now, meSeat, view.anim || {});
    ctx.restore();

    if (blasts.length) {
      ctx.fillStyle = `rgba(255,146,74,${Math.min(0.18, blasts.length * 0.015)})`;
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
      const fx = Cos.byId('bomb', id);
      const t = now % 1700;
      if (t < 1000) {
        ctx.save();
        ctx.translate(size / 2, size / 2); ctx.scale(1.4, 1.4); ctx.translate(-size / 2, -size / 2);
        drawBomb(ctx, { x: 1, y: 1, left: FUSE_MS * (1 - t / 1000) }, cell, now, fx);
        ctx.restore();
      } else {
        const left = BLAST_MS * (1 - (t - 1000) / 700);
        for (const [x, y] of [[1, 1], [0, 1], [2, 1], [1, 0], [1, 2]]) drawBlast(ctx, { x, y, left }, cell, now, fx);
      }
    }
  }

  window.drawBoard = drawBoard;
  window.drawPreview = drawPreview;
  window.KIND_COLOR = KIND_COLOR;
  window.skinColor = (p) => { const s = Cos.byId('skin', p.skin); return s.body ? s.body[0] : p.color; };
})();
