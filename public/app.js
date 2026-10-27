// Bomb Room client: menus, online lobby, input, and the render loop.
(function () {
  const APP_VERSION = '13'; // shown at the bottom of the menu; bump with each update
  const BG = window.BombGame;
  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  /* ---------------- Storage & identity ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const uuid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  let clientId = store.get('bombroom:id', null);
  if (!clientId) { clientId = uuid(); store.set('bombroom:id', clientId); }

  let soloDiff = store.get('bombroom:difficulty', 'medium');
  if (!BG.DIFF[soloDiff]) soloDiff = 'medium';

  const nameInput = $('nameInput');
  nameInput.value = store.get('bombroom:name', '');
  const myName = () => (nameInput.value.trim() || 'Player').slice(0, 16);
  nameInput.addEventListener('input', () => store.set('bombroom:name', nameInput.value.trim()));
  nameInput.addEventListener('change', () => netSend({ type: 'name', name: myName() }));

  /* ---------------- Screens & toast ---------------- */
  let screen = 'menu';
  function show(id) {
    for (const s of ['menu', 'shop', 'board', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id);
    screen = id;
  }
  let toastTimer;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  /* ---------------- Play state ---------------- */
  let kind = null;   // 'solo' | 'local' | 'online' | null
  let G = null;      // local game (solo / local duel)
  let meSeat = -1;

  /* ---------------- Network ---------------- */
  const net = {
    ws: null, open: false, retry: 0, timer: null, queue: [],
    room: null, phase: null, snap: null, grid: null, recvAt: 0,
    anim: {}, lastPos: {}, sentDir: null,
    pid: null, me: null, ranked: {},
  };

  function serverUrl() {
    if (window.BOMBROOM_SERVER) return window.BOMBROOM_SERVER;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    }
    return null;
  }

  function setStatus(text, cls) {
    const el = $('netStatus');
    el.textContent = text;
    el.className = 'status ' + (cls || '');
  }

  function connect() {
    const url = serverUrl();
    if (!url) { setStatus('No server', 'off'); return; }
    clearTimeout(net.timer);
    let ws;
    try { ws = new WebSocket(url); } catch (e) { setStatus('Offline', 'off'); return; }
    net.ws = ws;
    setStatus(net.retry ? 'Reconnecting…' : 'Connecting…');

    ws.onopen = () => {
      net.open = true;
      net.retry = 0;
      setStatus('Online', 'on');
      ws.send(JSON.stringify({ type: 'hello', id: clientId, name: myName(), look: Profile.look() }));
      const q = net.queue; net.queue = [];
      for (const m of q) ws.send(JSON.stringify(m));
      pred.pending = []; // anything unsent is gone; the server's view wins after a reconnect
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      onNet(m);
    };
    ws.onclose = (ev) => {
      if (net.ws !== ws) return;
      net.open = false;
      net.ws = null;
      if (ev.code === 4000) { setStatus('Open in another tab', 'off'); return; }
      setStatus('Offline', 'off');
      if (kind === 'online') toast('Connection lost. Reconnecting…');
      const delay = Math.min(8000, 500 * 2 ** net.retry++);
      net.timer = setTimeout(connect, delay);
    };
    ws.onerror = () => {};
  }

  function netSend(m) {
    if (net.open) { net.ws.send(JSON.stringify(m)); return; }
    if (m.type === 'input' || m.type === 'bomb' || m.type === 'name') return;
    net.queue.push(m);
    if (!net.ws) { net.retry = 0; connect(); }
  }

  function goOnline(msg) {
    if (!serverUrl()) {
      toast('Online play needs the server. Run "npm start" and open http://localhost:3000');
      return;
    }
    if (!net.open) toast('Connecting to the server… a sleeping server can take up to a minute.');
    netSend(msg);
  }

  function onNet(m) {
    switch (m.type) {
      case 'welcome': net.pid = m.pid; break;
      case 'me': net.me = m; renderRank(); break;
      case 'ranked':
        net.ranked[`${m.code}:${m.round}`] = m;
        net.me = Object.assign({}, net.me, { rating: m.rating, position: m.position });
        renderRank();
        if (overlayShown && kind === 'online') renderRankedLine();
        break;
      case 'leaderboard': renderLeaderboard(m); break;
      case 'room': onRoom(m); break;
      case 'state': onState(m); break;
      case 'error': toast(m.text); break;
      case 'notice': toast(m.text); break;
    }
  }

  function onRoom(r) {
    const prevPhase = net.phase;
    net.room = r;
    net.phase = r.phase;
    const me = r.members.find((x) => x.id === net.pid);
    if (!me) return;
    meSeat = me.seat === null ? -1 : me.seat;
    if (kind !== 'online') { G = null; kind = 'online'; clearHeld(); }

    if (r.phase === 'lobby') {
      hideOverlay();
      net.snap = null;
      show('lobby');
      renderLobby();
    } else if (r.phase === 'playing') {
      if (prevPhase !== 'playing') {
        net.snap = null; net.grid = null; net.anim = {}; net.lastPos = {}; net.sentDir = null;
        resetPrediction();
        hideOverlay();
      }
      if (screen !== 'game') enterGameScreen();
    } else if (r.phase === 'results') {
      if (screen !== 'game') enterGameScreen();
      showOnlineResult();
    }
  }

  function onState(s) {
    if (kind !== 'online') return;
    if (s.grid) net.grid = Uint8Array.from(s.grid, (c) => c.charCodeAt(0) - 48);
    const t = performance.now();
    meSeat = typeof s.you === 'number' ? s.you : -1;
    for (const p of s.players) {
      if (p.seat === meSeat) continue; // your own player is animated by prediction
      const lp = net.lastPos[p.seat];
      if (lp && Math.abs(lp.x - p.x) + Math.abs(lp.y - p.y) === 1) {
        net.anim[p.seat] = { from: { x: lp.x, y: lp.y }, t0: t };
      }
      net.lastPos[p.seat] = { x: p.x, y: p.y };
    }
    net.snap = s;
    net.recvAt = t;
    if (screen !== 'game') enterGameScreen();
  }

  /* ---------------- Menu ---------------- */
  function syncSeg(el, value) {
    el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.d === value));
  }
  const soloSeg = $('soloDiff');
  soloSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    soloDiff = b.dataset.d;
    store.set('bombroom:difficulty', soloDiff);
    syncSeg(soloSeg, soloDiff);
  }));
  syncSeg(soloSeg, soloDiff);

  $('soloBtn').addEventListener('click', () => startLocal('solo'));
  $('duelBtn').addEventListener('click', () => startLocal('local'));
  $('quickBtn').addEventListener('click', () => goOnline({ type: 'quick', name: myName() }));
  $('createBtn').addEventListener('click', () => goOnline({ type: 'create', name: myName(), difficulty: soloDiff, layout: soloLayout }));

  const codeInput = $('codeInput');
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  function joinCode() {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) { toast('Room codes are 4 characters.'); return; }
    goOnline({ type: 'join', code, name: myName() });
  }
  $('joinBtn').addEventListener('click', joinCode);
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinCode(); });

  /* ---------------- Coins & shop ---------------- */
  const Cos = window.Cosmetics;
  const randomSkin = () => Cos.SKINS[(Math.random() * Cos.SKINS.length) | 0].id;

  let shownCoins = Profile.coins;
  function renderCoins() {
    const bumped = Profile.coins > shownCoins;
    shownCoins = Profile.coins;
    for (const id of ['menuCoins', 'shopCoins']) {
      const el = $(id);
      el.querySelector('.amt').textContent = Profile.coins.toLocaleString('en-US');
      if (bumped) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    }
  }
  Profile.onChange(() => { renderCoins(); if (screen === 'shop') renderShop(); });
  renderCoins();

  let shopKind = 'skin';
  let previews = []; // { canvas, ctx, kind, id }
  const SHOP_NOTES = {
    skin: 'Other players see your character in online matches.',
    bomb: 'Your bombs and blasts use this effect, and other players see it online.',
    map: 'Map themes change how the arena looks on your screen.',
  };

  function renderShop() {
    document.querySelectorAll('#shopTabs button').forEach((b) => b.classList.toggle('on', b.dataset.k === shopKind));
    const items = Cos.CATALOG[shopKind];
    const eq = Profile.equipped(shopKind);
    // Free the old preview canvases right away (phones are slow to do it themselves).
    for (const p of previews) { p.canvas.width = 0; p.canvas.height = 0; }
    $('items').innerHTML = items.map((it) => {
      const owned = Profile.owns(shopKind, it.id);
      let btn;
      if (owned && it.id === eq) btn = '<button class="btn equipped-btn" disabled>Equipped</button>';
      else if (owned) btn = `<button class="btn owned" data-act="equip" data-id="${it.id}">Equip</button>`;
      else btn = `<button class="btn" data-act="buy" data-id="${it.id}" ${Profile.coins < it.price ? 'disabled' : ''}><span class="coin"></span>${it.price.toLocaleString('en-US')}</button>`;
      const tag = owned ? '<small>Owned</small>' : '';
      return `<div class="item${it.id === eq ? ' equipped' : ''}"><canvas data-id="${it.id}"></canvas><div class="nm">${esc(it.name)}${tag}</div>${btn}</div>`;
    }).join('');
    previews = [...$('items').querySelectorAll('canvas')].map((c) => ({ canvas: c, ctx: c.getContext('2d'), kind: shopKind, id: c.dataset.id }));
    const cheapest = items.filter((i) => !Profile.owns(shopKind, i.id)).sort((a, b) => a.price - b.price)[0];
    let note = SHOP_NOTES[shopKind];
    if (cheapest && cheapest.price > Profile.coins) note += ` ${cheapest.price - Profile.coins} more coins unlocks ${cheapest.name}.`;
    $('shopNote').textContent = note;
  }

  function drawPreviews(now) {
    const dpr = window.devicePixelRatio || 1;
    for (const p of previews) {
      const size = p.canvas.clientWidth;
      if (!size || !p.ctx) continue;
      const px = Math.round(size * dpr);
      if (p.canvas.width !== px) { p.canvas.width = px; p.canvas.height = px; }
      p.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { window.drawPreview(p.ctx, size, p.kind, p.id, now); } catch (e) { reportDrawError(e, 'shop preview ' + p.id); }
    }
  }

  $('items').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const item = Cos.byId(shopKind, id);
    if (b.dataset.act === 'buy') {
      const res = Profile.buy(shopKind, id);
      if (!res.ok) { toast(res.reason); return; }
      toast(`Unlocked ${item.name}!`);
      if (navigator.vibrate) { try { navigator.vibrate([20, 40, 20]); } catch (err) {} }
    } else {
      Profile.equip(shopKind, id);
    }
    if (shopKind !== 'map') netSend({ type: 'look', ...Profile.look() });
  });
  $('shopTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    shopKind = b.dataset.k;
    renderShop();
  });
  $('shopBtn').addEventListener('click', () => { renderShop(); show('shop'); });
  $('shopBack').addEventListener('click', () => { previews = []; show('menu'); });

  /* ---------------- Lobby ---------------- */
  const lobbySeg = $('lobbyDiff');
  lobbySeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (net.room && net.room.hostId === net.pid) netSend({ type: 'settings', difficulty: b.dataset.d });
  }));
  $('botsToggle').addEventListener('change', (e) => netSend({ type: 'settings', fillBots: e.target.checked }));
  $('startBtn').addEventListener('click', () => netSend({ type: 'start' }));
  $('lobbyLeave').addEventListener('click', toMenu);

  function inviteLink(code) {
    let base;
    if (window.BOMBROOM_SERVER) base = window.BOMBROOM_SERVER.replace(/^ws/, 'http').replace(/\/$/, '') + '/';
    else if (/^https?:$/.test(location.protocol)) base = location.origin + location.pathname.replace(/index\.html$/, '');
    else return null;
    return `${base}?room=${code}`;
  }
  $('inviteBtn').addEventListener('click', async () => {
    if (!net.room) return;
    const code = net.room.code;
    const url = inviteLink(code);
    const text = `Join my Bomb Room match! Room code ${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Bomb Room', text, url: url || undefined }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url || code);
      toast(url ? 'Invite link copied.' : 'Room code copied.');
    } catch (e) {
      toast(`Room code: ${code}`);
    }
  });

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderLobby() {
    const r = net.room;
    if (!r) return;
    const isHost = r.hostId === net.pid;
    const online = r.members.filter((m) => m.connected).length;
    $('lobbyLabel').textContent = r.quick ? 'Quick match' : 'Private room';
    $('lobbyCode').textContent = r.code;
    $('lobbyCount').textContent = `${Math.min(online, r.maxPlayers)}/${r.maxPlayers}`;

    let html = '';
    for (let i = 0; i < r.maxPlayers; i++) {
      const m = r.members[i];
      if (m) {
        const tags = [];
        if (m.id === r.hostId) tags.push('<b>Host</b>');
        if (m.id === net.pid) tags.push('You');
        if (!m.connected) tags.push('Away');
        html += `<div class="slot${m.connected ? '' : ' away'}"><span class="dot" style="background:${BG.COLORS[i]}"></span>${esc(m.name)}<span class="tag">${tags.join(' · ')}</span></div>`;
      } else {
        html += `<div class="slot empty"><span class="dot" style="background:${BG.COLORS[i]};opacity:.35"></span>${r.fillBots ? 'Bot' : 'Open seat'}</div>`;
      }
    }
    const watchers = r.members.length - r.maxPlayers;
    if (watchers > 0) html += `<p class="muted">+${watchers} watching</p>`;
    $('slots').innerHTML = html;

    $('botsToggle').checked = r.fillBots;
    $('botsToggle').disabled = !isHost;
    syncSeg(lobbySeg, r.difficulty);
    renderLayoutChips($('lobbyLayout'), r.layout, !isHost);
    lobbySeg.classList.toggle('locked', !isHost);
    $('hostNote').textContent = isHost ? 'You are host' : 'Host decides';

    let wait;
    if (r.quick && r.autoStartIn !== null) wait = `Starting in ${r.autoStartIn}s…`;
    else if (r.quick) wait = 'Looking for players… the match starts when someone else joins.';
    else if (!isHost) wait = 'Waiting for the host to start…';
    else if (online < 2) wait = r.fillBots ? 'Share the code, or start now against bots.' : 'Share the code. You need at least 2 players.';
    else wait = 'Everyone ready? Start when you like.';
    $('lobbyWait').textContent = wait;

    const startBtn = $('startBtn');
    startBtn.classList.toggle('hidden', !isHost);
    startBtn.textContent = r.quick ? 'Start now' : 'Start match';
    startBtn.disabled = !r.fillBots && online < 2;
  }

  /* ---------------- Local games ---------------- */
  function startLocal(k) {
    if (kind === 'online') leaveOnline();
    kind = k;
    const now = performance.now();
    const look = Profile.look();
    const bot = (n) => ({ name: `Bot ${n}`, isBot: true, skin: randomSkin() });
    const seats = k === 'solo'
      ? [{ name: 'You', skin: look.skin, bomb: look.bomb }, bot(1), bot(2), bot(3)]
      : [{ name: 'P1', skin: look.skin, bomb: look.bomb }, { name: 'P2' }];
    G = BG.createGame({ mode: k, difficulty: soloDiff, seats, now, layout: soloLayout });
    meSeat = k === 'solo' ? 0 : -1;
    clearHeld();
    hideOverlay();
    enterGameScreen();
  }

  function leaveOnline() {
    netSend({ type: 'leave' });
    net.room = null; net.phase = null; net.snap = null; net.grid = null;
    net.anim = {}; net.lastPos = {}; net.sentDir = null;
  }

  function toMenu() {
    if (kind === 'online') leaveOnline();
    kind = null;
    G = null;
    clearHeld();
    hideOverlay();
    show('menu');
  }

  function enterGameScreen() {
    hudSig = '';
    cam.snap = true;
    show('game');
    let hint;
    if (kind === 'online') hint = 'Move <kbd>WASD</kbd>/<kbd>Arrows</kbd> · Bomb <kbd>Space</kbd> · Leave <kbd>Esc</kbd>';
    else if (kind === 'solo') hint = 'Move <kbd>WASD</kbd>/<kbd>Arrows</kbd> · Bomb <kbd>Space</kbd> · Menu <kbd>Esc</kbd>';
    else hint = 'P1 <kbd>WASD</kbd> + <kbd>Space</kbd> · P2 <kbd>Arrows</kbd> + <kbd>Enter</kbd> · Menu <kbd>Esc</kbd>';
    $('hint').innerHTML = hint;
  }

  function gameLabel(layoutId) {
    const arena = BG.LAYOUTS[layoutId] ? BG.LAYOUTS[layoutId].name : '';
    let label;
    if (kind === 'online') label = net.room ? `Room ${net.room.code}` : 'Online';
    else if (kind === 'solo') label = `Solo · ${G.difficulty}`;
    else label = 'Local duel';
    return arena ? `${label} · ${arena}` : label;
  }
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  $('gameExit').addEventListener('click', toMenu);

  function again() {
    if (kind === 'solo' || kind === 'local') startLocal(kind);
    else if (kind === 'online' && net.room && net.room.hostId === net.pid) netSend({ type: 'start' });
  }

  /* ---------------- Results overlay ---------------- */
  let overlayShown = false;
  function hideOverlay() { overlayShown = false; $('overlay').classList.add('hidden'); }

  function openOverlay(title, sub, { canAgain, toLobby, leaveText, reward }) {
    overlayShown = true;
    $('resultText').textContent = title;
    $('resultSub').textContent = sub;
    showReward(reward);
    renderRankedLine();
    $('againBtn').classList.toggle('hidden', !canAgain);
    $('toLobbyBtn').classList.toggle('hidden', !toLobby);
    $('overlayLeave').textContent = leaveText;
    $('overlayKeys').classList.toggle('hidden', !canAgain);
    $('overlay').classList.remove('hidden');
  }

  function showLocalResult() {
    if (overlayShown) return;
    let title, sub, reward;
    if (G.mode === 'solo') {
      const me = G.players[0];
      const won = me.alive && G.winner === 0;
      title = won ? 'You win!' : 'Blown up';
      sub = won ? `Cleared the room on ${G.difficulty}.` : (G.winner !== null ? `${G.players[G.winner].name} takes it.` : 'Better luck next round.');
      reward = Profile.award({ mode: 'solo', difficulty: G.difficulty, won, crates: me.crates, kills: me.kills });
    } else {
      title = G.winner === null ? 'Draw' : `${G.players[G.winner].name} wins!`;
      sub = G.winner === null ? 'Both went down together.' : 'Last one standing.';
      reward = Profile.award({ mode: 'local', won: G.winner !== null });
    }
    openOverlay(title, sub, { canAgain: true, toLobby: false, leaveText: 'Menu', reward });
  }

  let lastOnlineReward = { key: null, reward: null };
  function showOnlineResult() {
    const s = net.snap;
    const r = net.room;
    if (!r) return;
    const isHost = r.hostId === net.pid;
    let title = 'Round over', sub = '', reward = null;
    if (s) {
      const w = s.winner;
      if (w === null) title = 'Draw';
      else if (w === meSeat) title = 'You win!';
      else title = `${s.players[w].name} wins!`;
      if (meSeat < 0) sub = 'You play next round.';
      else if (w !== meSeat) sub = 'Better luck next round.';
      else sub = 'Last one standing.';

      // Pay out once per round (the results screen can be redrawn when people join or leave).
      const key = `${r.code}:${s.round}`;
      if (lastOnlineReward.key === key) reward = lastOnlineReward.reward;
      else if (meSeat >= 0 && s.players[meSeat]) {
        const me = s.players[meSeat];
        reward = Profile.award({
          key, mode: 'online', won: w === meSeat, crates: me.crates, kills: me.kills,
          humanOpponents: s.players.filter((p) => !p.isBot && p.seat !== meSeat).length,
        });
        lastOnlineReward = { key, reward };
      }
    }
    sub += isHost ? '' : ' Waiting for the host…';
    openOverlay(title, sub.trim(), { canAgain: isHost, toLobby: isHost, leaveText: 'Leave', reward });
  }

  // Coin breakdown with a quick count-up.
  let countTimer = null;
  function showReward(reward) {
    const box = $('reward');
    clearInterval(countTimer);
    if (!reward) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('rewardLines').innerHTML = reward.lines.map(([label, n]) =>
      `<div class="${/today/.test(label) ? 'bonus' : ''}"><b>${esc(label)}</b><span>+${n}</span></div>`).join('');
    const totalEl = $('rewardTotal');
    let shown = 0;
    const step = Math.max(1, Math.ceil(reward.total / 25));
    totalEl.textContent = '+0';
    countTimer = setInterval(() => {
      shown = Math.min(reward.total, shown + step);
      totalEl.textContent = `+${shown}`;
      if (shown >= reward.total) clearInterval(countTimer);
    }, 30);
  }
  $('overlayLeave').addEventListener('click', toMenu);
  $('againBtn').addEventListener('click', again);
  $('toLobbyBtn').addEventListener('click', () => netSend({ type: 'lobby' }));

  /* ---------------- Input ---------------- */
  const held = { 0: [], 1: [] };
  const heldDir = (seat) => { const h = held[seat]; return h && h.length ? h[h.length - 1] : null; };
  function press(seat, dir) { const h = held[seat]; if (!h.includes(dir)) h.push(dir); syncInput(); }
  function release(seat, dir) { const h = held[seat]; const i = h.indexOf(dir); if (i >= 0) h.splice(i, 1); syncInput(); }
  function clearHeld() {
    held[0].length = 0; held[1].length = 0;
    if (stickId !== null || stickDir) resetStick(); // eslint-disable-line no-use-before-define
    syncInput();
  }
  /* ---------------- Online prediction ----------------
     Online, the phone asks the server for one tile at a time and moves your player straight
     away on screen. The server checks each step and answers with the last one it handled
     (ack); anything it hasn't handled yet is replayed on top of its position. So your player
     reacts instantly and stops the moment you let go, however slow the connection is. */
  const pred = { seq: 0, pending: [], lastStep: -1e9, moveDir: null, shown: null };
  function resetPrediction() {
    pred.pending = []; pred.lastStep = -1e9; pred.moveDir = null; pred.shown = null;
  }
  function onlineWalkable(x, y) {
    const s = net.snap;
    if (!net.grid || x < 0 || y < 0 || x >= BG.COLS || y >= BG.ROWS) return false;
    if (net.grid[y * BG.COLS + x] !== BG.FLOOR) return false;
    return !s.bombs.some((b) => b.x === x && b.y === y);
  }
  const onlineCan = (x, y, d) => onlineWalkable(x + BG.DIRS[d][0], y + BG.DIRS[d][1]);
  // Server position + the steps it hasn't answered yet.
  function predictedPos() {
    const me = net.snap && net.snap.players[meSeat];
    if (!me) return null;
    pred.pending = pred.pending.filter((p) => p.seq > me.ack);
    let x = me.x, y = me.y;
    for (const p of pred.pending) {
      if (p.dir && onlineCan(x, y, p.dir)) { x += BG.DIRS[p.dir][0]; y += BG.DIRS[p.dir][1]; }
    }
    return { x, y, facing: pred.moveDir || me.facing };
  }
  function predictionTick(now) {
    const s = net.snap;
    const me = s && s.players[meSeat];
    if (!me || !me.alive || s.status !== 'playing') { pred.pending = []; return; }
    const want = heldDir(0);
    if (!want) { pred.moveDir = null; return; }
    if (now - pred.lastStep < BG.moveCooldown(me)) return;
    const pos = predictedPos();
    const dir = BG.assistDir(onlineCan, pos.x, pos.y, want, pred.moveDir);
    if (!onlineCan(pos.x, pos.y, dir)) { pred.moveDir = null; return; }
    pred.seq++;
    pred.pending.push({ seq: pred.seq, dir });
    pred.lastStep = now;
    pred.moveDir = dir;
    netSend({ type: 'step', dir, seq: pred.seq });
  }
  // The players list to draw, with your own player at the predicted spot (and its step animation).
  function playersWithPrediction(players, now) {
    const me = players[meSeat];
    if (!me || !me.alive) return players;
    const pos = predictedPos();
    if (pred.shown && (pred.shown.x !== pos.x || pred.shown.y !== pos.y)) {
      const dist = Math.abs(pred.shown.x - pos.x) + Math.abs(pred.shown.y - pos.y);
      net.anim[meSeat] = dist === 1 ? { from: { x: pred.shown.x, y: pred.shown.y }, t0: now } : null;
    }
    pred.shown = { x: pos.x, y: pos.y };
    return players.map((p) => (p === me ? Object.assign({}, p, pos) : p));
  }

  // Offline modes read held directions straight from held; online movement goes through
  // predictionTick (one message per tile), so nothing needs sending here.
  function syncInput() {}
  function doBomb(seat) {
    if (kind === 'online') {
      pred.seq++;
      pred.pending.push({ seq: pred.seq, bomb: true });
      netSend({ type: 'bomb', seq: pred.seq });
    }
    else if (G) BG.placeBomb(G, G.players[seat]);
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
  }

  const WASD = { w: 'up', a: 'left', s: 'down', d: 'right' };
  const ARROWS = { arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right' };
  function binding(key) {
    const k = key.toLowerCase();
    if (kind === 'local') {
      if (WASD[k]) return { seat: 0, dir: WASD[k] };
      if (k === ' ') return { seat: 0, bomb: true };
      if (ARROWS[k]) return { seat: 1, dir: ARROWS[k] };
      if (k === 'enter') return { seat: 1, bomb: true };
      return null;
    }
    if (WASD[k]) return { seat: 0, dir: WASD[k] };
    if (ARROWS[k]) return { seat: 0, dir: ARROWS[k] };
    if (k === ' ' || k === 'enter') return { seat: 0, bomb: true };
    return null;
  }

  window.addEventListener('keydown', (e) => {
    if (screen !== 'game' || e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') { toMenu(); return; }
    if (e.key.toLowerCase() === 'r' && overlayShown) { again(); return; }
    const b = binding(e.key);
    if (!b) return;
    e.preventDefault();
    if (b.dir) press(b.seat, b.dir);
    else if (!e.repeat && !overlayShown) doBomb(b.seat);
  });
  window.addEventListener('keyup', (e) => {
    const b = binding(e.key);
    if (b && b.dir) release(b.seat, b.dir);
  });
  window.addEventListener('blur', clearHeld);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearHeld();
    else if (!net.ws && serverUrl()) { net.retry = 0; connect(); }
  });

  // Floating joystick: put your thumb down anywhere in the zone and slide to steer.
  // The base follows your thumb if you drag past the edge, so reversing direction is instant.
  const zone = $('stickZone'), stick = $('stick'), knob = $('knob');
  const STICK_R = 42;     // how far the knob travels from the centre (px)
  const DEAD = 16;        // ignore small movements around the centre (slide back to stop)
  const SWITCH = 1.3;     // must lean this much more toward the new axis to change axis (stops jitter on diagonals)
  let stickId = null, stickDir = null, base = { x: 0, y: 0 };

  function pickDir(dx, dy, cur) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.hypot(dx, dy) < DEAD) return null;
    const horiz = dx > 0 ? 'right' : 'left', vert = dy > 0 ? 'down' : 'up';
    if (cur === 'left' || cur === 'right') return ay > ax * SWITCH ? vert : horiz;
    if (cur === 'up' || cur === 'down') return ax > ay * SWITCH ? horiz : vert;
    return ax > ay ? horiz : vert;
  }
  function setStickDir(d) {
    if (d === stickDir) return;
    stickDir = d;
    held[0].length = 0;
    if (d) held[0].push(d);
    syncInput();
    if (d && navigator.vibrate) { try { navigator.vibrate(6); } catch (e) {} }
  }
  function zonePoint(e) {
    const r = zone.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function placeStick() { stick.style.left = base.x + 'px'; stick.style.top = base.y + 'px'; }
  function resetStick() {
    stickId = null;
    stick.classList.remove('active');
    stick.style.left = ''; stick.style.top = '';
    knob.style.transform = '';
    setStickDir(null);
  }
  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch (err) {}
    base = zonePoint(e);
    placeStick();
    knob.style.transform = '';
    stick.classList.add('active');
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    const p = zonePoint(e);
    let dx = p.x - base.x, dy = p.y - base.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      base.x = p.x - (dx / d) * STICK_R;
      base.y = p.y - (dy / d) * STICK_R;
      placeStick();
      dx = (dx / d) * STICK_R; dy = (dy / d) * STICK_R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    setStickDir(pickDir(dx, dy, stickDir));
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => zone.addEventListener(t, (e) => {
    if (e.pointerId === stickId) resetStick();
  }));
  $('bombBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); doBomb(0); });

  /* ---------------- HUD & banner ---------------- */
  let hudSig = '';
  function renderHud(players) {
    const sig = meSeat + '#' + players.map((p) => `${p.name}${p.alive}${p.maxBombs}${p.range}${p.speed}`).join('|');
    if (sig === hudSig) return;
    hudSig = sig;
    $('hud').style.setProperty('--n', players.length);
    const K = window.KIND_COLOR;
    $('hud').innerHTML = players.map((p) => `
      <div class="chip${p.alive ? '' : ' dead'}${p.seat === meSeat ? ' me' : ''}">
        <span class="dot" style="background:${p.color}"></span>
        <span class="nm">${esc(p.name)}</span>
        <span class="st">
          <span style="color:${K.bombs}" title="Bombs">●${p.maxBombs}</span>
          <span style="color:${K.blast}" title="Blast range">✹${p.range}</span>
          <span style="color:${K.speed}" title="Speed">»${p.speed}</span>
        </span>
      </div>`).join('');
  }

  function setBanner(text, small) {
    const el = $('banner');
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('small', !!small);
  }

  /* ---------------- Camera ---------------- */
  // Zoomed in on your own player; eases out to the whole arena when there's no one to follow
  // (local duel, watching, or after you're knocked out).
  const ZOOM = 1.5;
  const CENTER = BG.COLS / 2;
  const cam = { x: CENTER, y: CENTER, zoom: 1, snap: true };
  function updateCamera(view, status, dt, now) {
    let tx = CENTER, ty = CENTER, tz = 1;
    const me = view && meSeat >= 0 ? view.players[meSeat] : null;
    if (me && kind !== 'local' && (me.alive || status === 'ending')) {
      const p = window.playerPos(me, view.anim, now);
      tx = p.x + 0.5; ty = p.y + 0.5; tz = ZOOM;
    }
    if (cam.snap) { cam.x = tx; cam.y = ty; cam.zoom = tz; cam.snap = !view; return; }
    const k = 1 - Math.exp(-dt / 110);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.zoom += (tz - cam.zoom) * (1 - Math.exp(-dt / 350));
  }

  /* ---------------- Main loop ---------------- */
  // If drawing ever fails on a device, show the error once (so it can be reported) and keep going.
  let drawErrorShown = false;
  function reportDrawError(e, where) {
    console.error('Draw error in', where, e);
    if (drawErrorShown) return;
    drawErrorShown = true;
    toast(`Display error (${where}): ${e && e.message ? e.message : e} · v${APP_VERSION}`);
  }

  let last = performance.now();
  function frame(now) {
    try { frameBody(now); } catch (e) { reportDrawError(e, screen); }
    requestAnimationFrame(frame);
  }
  function frameBody(now) {
    const dt = Math.min(50, now - last);
    last = now;

    if (screen === 'game') {
      let view = null, status = null, readyIn = 0, goIn = 0, shrinkIn = Infinity, hurryIn = 0;

      if ((kind === 'solo' || kind === 'local') && G) {
        for (const p of G.players) if (!p.isBot) p.input = heldDir(p.seat);
        BG.step(G, dt, now);
        view = {
          grid: G.grid, players: G.players, bombs: G.bombs, explosions: G.explosions, powerups: G.powerups,
          anim: G.anim, layout: G.layout, wallVer: G.wallVer, shrinkNext: BG.shrinkWarning(G, now),
        };
        status = G.status;
        readyIn = G.readyUntil - now; goIn = G.goUntil - now;
        shrinkIn = G.shrinkAt - now; hurryIn = G.hurryUntil - now;
        if (G.status === 'over') showLocalResult();
      } else if (kind === 'online' && net.snap) {
        predictionTick(now);
        const s = net.snap, age = now - net.recvAt;
        view = {
          grid: net.grid,
          players: playersWithPrediction(s.players, now),
          bombs: s.bombs.map((b) => ({ x: b.x, y: b.y, owner: b.owner, left: b.left - age })),
          explosions: s.explosions.map((e) => ({ x: e.x, y: e.y, owner: e.owner, left: e.left - age })),
          powerups: s.powerups,
          anim: net.anim,
          layout: s.layout, wallVer: s.wallVer, round: s.round, shrinkNext: s.shrinkNext,
        };
        status = s.status;
        readyIn = s.readyIn - age; goIn = s.goIn - age;
        shrinkIn = s.shrinkIn - age; hurryIn = s.hurryIn - age;
      }

      const size = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      const px = Math.round(size * dpr);
      if (px > 0 && canvas.width !== px) { canvas.width = px; canvas.height = px; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      updateCamera(view, status, dt, now);
      window.drawBoard(ctx, size, view, now, meSeat, Profile.equipped('map'), cam);

      if (view) {
        renderHud(view.players);
        setText($('modeLabel'), gameLabel(view.layout));
        const clock = $('clock');
        if (status === 'playing' || status === 'ready') {
          if (shrinkIn > 0) {
            const sec = Math.ceil(Math.min(shrinkIn, BG.ROUND_MS) / 1000);
            setText(clock, `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
            clock.classList.toggle('hurry', sec <= 10);
          } else { setText(clock, 'Sudden death'); clock.classList.add('hurry'); }
        } else setText(clock, '');
        if (status === 'ready' && readyIn > 0) setBanner('Ready…');
        else if (goIn > 0) setBanner('Go!');
        else if (hurryIn > 0) setBanner('Hurry up!');
        else if (kind === 'online' && meSeat < 0 && status !== 'over') setBanner('Watching · you play next round', true);
        else setBanner('');
        const me = view.players[meSeat];
        const mine = me ? view.bombs.filter((b) => b.owner === meSeat).length : 0;
        $('bombBtn').disabled = !(me && me.alive && status === 'playing' && mine < me.maxBombs);
      } else {
        setBanner(kind === 'online' ? 'Loading match…' : '', true);
      }
    } else if (screen === 'shop') {
      drawPreviews(now);
    }
  }
  requestAnimationFrame(frame);

  /* ---------------- Install as app (PWA) ---------------- */
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    $('installText').textContent = 'Play full screen from your home screen.';
    $('installBtn').classList.remove('hidden');
    $('installBox').classList.remove('hidden');
  });
  $('installBtn').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch (e) {}
    installEvent = null;
    $('installBox').classList.add('hidden');
  });
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && !standalone && /^https?:$/.test(location.protocol)) {
    $('installText').textContent = 'Install on iPhone: tap Share, then “Add to Home Screen”.';
    $('installBox').classList.remove('hidden');
  }
  const swAllowed = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && swAllowed) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  /* ---------------- Arenas ---------------- */
  let soloLayout = store.get('bombroom:layout', 'random');
  if (soloLayout !== 'random' && !BG.LAYOUTS[soloLayout]) soloLayout = 'random';
  const LAYOUT_CHOICES = [['random', 'Random'], ...BG.LAYOUT_IDS.map((id) => [id, BG.LAYOUTS[id].name])];
  function renderLayoutChips(el, value, locked) {
    if (!el.childElementCount) {
      el.innerHTML = LAYOUT_CHOICES.map(([id, name]) => `<button data-l="${id}">${name}</button>`).join('');
    }
    el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.l === value));
    el.classList.toggle('locked', !!locked);
  }
  renderLayoutChips($('soloLayout'), soloLayout);
  $('soloLayout').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-l]');
    if (!b) return;
    soloLayout = b.dataset.l;
    store.set('bombroom:layout', soloLayout);
    renderLayoutChips($('soloLayout'), soloLayout);
  });
  $('lobbyLayout').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-l]');
    if (b && net.room && net.room.hostId === net.pid) netSend({ type: 'settings', layout: b.dataset.l });
  });

  /* ---------------- Rank & leaderboard ---------------- */
  function rankText(me) {
    if (!me || me.rating === null || me.rating === undefined) return null;
    const tier = Ranks.tierFor(me.rating);
    const next = Ranks.nextTier(me.rating);
    return { tier, next };
  }
  function paintBadge(el, info, rating) {
    if (!info) { el.textContent = 'Unranked'; el.style.removeProperty('--tier'); return; }
    el.textContent = `${info.tier.name} · ${rating}`;
    el.style.setProperty('--tier', info.tier.color);
  }
  function renderRank() {
    const me = net.me;
    const info = rankText(me);
    for (const [badgeId, infoId] of [['rankBadge', 'rankInfo'], ['boardBadge', 'boardInfo']]) {
      paintBadge($(badgeId), info, me && me.rating);
      let text;
      if (!info) text = 'Play an online match with at least one friend to get ranked.';
      else {
        text = `#${me.position || '?'} · ${me.wins || 0} wins in ${me.matches || 0} ranked matches`;
        if (info.next) text += ` · ${info.next.min - me.rating} to ${info.next.name}`;
      }
      setText($(infoId), text);
    }
  }
  renderRank();

  function renderLeaderboard(m) {
    const list = $('lbList');
    if (m.error) { list.innerHTML = `<p class="muted">${esc(m.error)}</p>`; return; }
    if (!m.top.length) { list.innerHTML = '<p class="muted">No ranked matches yet. Be the first!</p>'; return; }
    list.innerHTML = m.top.map((r, i) => {
      const t = Ranks.tierFor(r.rating);
      return `<div class="lb-row${r.me ? ' me' : ''}"><span class="pos">${i + 1}</span>`
        + `<span class="nm">${esc(r.name)}${r.me ? ' (you)' : ''}</span>`
        + `<span class="tier" style="color:${t.color}">${t.name}</span><span class="pts">${r.rating}</span></div>`;
    }).join('');
    let note = `${m.total} ranked player${m.total === 1 ? '' : 's'}. Ranked points come from online matches with at least 2 real players: the longer you survive, the more you gain.`;
    if (!m.saved) note += ' (Test server: rankings reset when it restarts.)';
    setText($('lbNote'), note);
  }
  $('lbBtn').addEventListener('click', () => {
    if (!serverUrl()) { toast('The leaderboard needs the server. Run "npm start" and open http://localhost:3000'); return; }
    $('lbList').innerHTML = '<p class="muted">Loading…</p>';
    show('board');
    goOnline({ type: 'leaderboard' });
  });
  $('boardBack').addEventListener('click', () => show('menu'));

  function renderRankedLine() {
    const el = $('rankedLine');
    const r = net.room, s = net.snap;
    if (kind !== 'online' || !r || !s || meSeat < 0) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (!r.ranked) { el.innerHTML = '<span class="muted">Unranked: ranked needs 2+ real players.</span>'; return; }
    const res = net.ranked[`${r.code}:${s.round}`];
    if (!res) { el.innerHTML = '<span class="muted">Updating rank…</span>'; return; }
    const t = Ranks.tierFor(res.rating);
    const cls = res.delta >= 0 ? 'up' : 'down';
    el.innerHTML = `<span class="${cls}">${res.delta >= 0 ? '+' : ''}${res.delta}</span> ranked points · ${res.rating} <span style="color:${t.color}">${t.name}</span> · #${res.position}`;
  }

  /* ---------------- No browser zoom ----------------
     iPhone Safari ignores "user-scalable=no", so block double-tap and pinch zoom here too. */
  // Only a second tap on the same spot counts as a double-tap; quick taps on different buttons work.
  let lastTap = { t: 0, x: 0, y: 0 };
  document.addEventListener('touchend', (e) => {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const t = Date.now();
    const near = Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 40;
    if (t - lastTap.t < 350 && near && !e.target.closest('input, textarea')) e.preventDefault();
    lastTap = { t, x: touch.clientX, y: touch.clientY };
  }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault());

  /* ---------------- Start up ---------------- */
  const vEl = document.getElementById('appVersion');
  if (vEl) vEl.textContent = `Version ${APP_VERSION}`;
  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (serverUrl()) connect(); else setStatus('No server', 'off');
  if (roomParam) {
    codeInput.value = roomParam;
    history.replaceState(null, '', location.pathname);
    goOnline({ type: 'join', code: roomParam, name: myName() });
  }
})();
