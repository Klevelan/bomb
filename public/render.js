// Canvas renderer (your original Base44 renderer, unchanged in look).
// drawBoard(ctx, size, view, now, meSeat) where view = { grid, players, bombs, explosions, powerups, anim }.
(function () {
  const { COLS, ROWS, WALL, BOX, BLAST_MS, STEP_ANIM } = window.BombGame;

  const C = {
    floorA: '#0C1015', floorB: '#0F141B',
    wall: '#222A38', wallEdge: '#2E3849',
    box: '#7B5539', boxTop: '#95663F', boxLine: '#573C27',
    bomb: '#13171E', bombRim: '#2A3342', spark: '#FF7A4D',
  };
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

  function drawWall(ctx, x, y, cell) {
    const pad = cell * 0.045;
    roundRect(ctx, x * cell + pad, y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.16);
    ctx.fillStyle = C.wall; ctx.fill();
    ctx.strokeStyle = C.wallEdge; ctx.lineWidth = Math.max(1, cell * 0.035); ctx.stroke();
  }

  function drawBox(ctx, x, y, cell) {
    const px = x * cell, py = y * cell, pad = cell * 0.075, w = cell - pad * 2;
    roundRect(ctx, px + pad, py + pad, w, w, cell * 0.16);
    ctx.fillStyle = C.box; ctx.fill();
    ctx.fillStyle = C.boxTop;
    roundRect(ctx, px + pad + w * 0.12, py + pad + w * 0.12, w * 0.76, w * 0.26, cell * 0.08);
    ctx.fill();
    ctx.strokeStyle = C.boxLine; ctx.lineWidth = Math.max(1, cell * 0.045);
    ctx.beginPath();
    ctx.moveTo(px + cell * 0.5, py + pad + w * 0.4);
    ctx.lineTo(px + cell * 0.5, py + cell - pad);
    ctx.stroke();
  }

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

  function drawBomb(ctx, b, cell, now) {
    const left = Math.max(0, b.left);
    const cx = (b.x + 0.5) * cell, cy = (b.y + 0.5) * cell;
    const pulse = 1 + Math.sin(now / (70 + left * 0.1)) * 0.075;
    const r = cell * 0.32 * pulse;

    ctx.save();
    ctx.shadowColor = 'rgba(255,90,60,0.5)'; ctx.shadowBlur = cell * 0.4;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = C.bomb; ctx.fill();
    ctx.restore();

    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = C.bombRim; ctx.lineWidth = Math.max(1.5, cell * 0.045); ctx.stroke();

    ctx.beginPath(); ctx.arc(cx + r * 0.6, cy - r * 0.8, Math.max(1.6, cell * 0.07), 0, Math.PI * 2);
    ctx.fillStyle = C.spark; ctx.fill();
  }

  function drawBlast(ctx, e, cell) {
    const left = Math.max(0, e.left);
    const t = 1 - left / BLAST_MS;
    const a = Math.max(0, 1 - t * t);
    const cx = (e.x + 0.5) * cell, cy = (e.y + 0.5) * cell;
    const s = cell * (0.96 + t * 0.18);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.78);
    grad.addColorStop(0, `rgba(255,240,196,${a})`);
    grad.addColorStop(0.45, `rgba(255,150,70,${a * 0.95})`);
    grad.addColorStop(1, `rgba(226,62,62,${a * 0.12})`);
    roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.34);
    ctx.fillStyle = grad; ctx.fill();
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

    ctx.save();
    if (!p.alive) ctx.globalAlpha = 0.2;

    if (p.seat === meSeat) {
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.62, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(1.5, cell * 0.04); ctx.stroke();
    }

    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.95, r * 0.78, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();

    const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    grad.addColorStop(0, shade(p.color, 0.08));
    grad.addColorStop(1, shade(p.color, -0.22));
    roundRect(ctx, cx - r, cy - r, r * 2, r * 2, r * 0.52);
    ctx.fillStyle = grad; ctx.fill();

    if (p.alive) {
      const look = { up: [0, -0.22], down: [0, 0.16], left: [-0.22, 0.04], right: [0.22, 0.04] }[p.facing] || [0, 0.12];
      ctx.fillStyle = 'rgba(10,14,20,0.78)';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + side * r * 0.34 + look[0] * r, cy - r * 0.12 + look[1] * r, r * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = 'rgba(12,16,21,0.9)'; ctx.lineWidth = Math.max(1.5, cell * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.4, cy - r * 0.4); ctx.lineTo(cx + r * 0.4, cy + r * 0.4);
      ctx.moveTo(cx + r * 0.4, cy - r * 0.4); ctx.lineTo(cx - r * 0.4, cy + r * 0.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBoard(ctx, size, view, now, meSeat) {
    const cell = size / COLS;
    ctx.clearRect(0, 0, size, size);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? C.floorA : C.floorB;
        ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
      }
    }
    if (!view || !view.grid) return;

    const blasts = view.explosions || [];
    const shake = Math.min(1, blasts.length / 9) * cell * 0.16;
    ctx.save();
    if (shake > 0.3) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = view.grid[y * COLS + x];
        if (v === WALL) drawWall(ctx, x, y, cell);
        else if (v === BOX) drawBox(ctx, x, y, cell);
      }
    }
    for (const u of view.powerups || []) drawPowerup(ctx, u, cell, now);
    for (const b of view.bombs || []) drawBomb(ctx, b, cell, now);
    for (const e of blasts) drawBlast(ctx, e, cell);
    for (const p of view.players || []) drawPlayer(ctx, p, cell, now, meSeat, view.anim || {});
    ctx.restore();

    if (blasts.length) {
      ctx.fillStyle = `rgba(255,146,74,${Math.min(0.22, blasts.length * 0.02)})`;
      ctx.fillRect(0, 0, size, size);
    }
  }

  window.drawBoard = drawBoard;
  window.KIND_COLOR = KIND_COLOR;
})();
