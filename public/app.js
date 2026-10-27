// Bomb Room client: menus, online lobby, input, and the render loop.
(function () {
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
    for (const s of ['menu', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id);
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
      ws.send(JSON.stringify({ type: 'hello', id: clientId, name: myName() }));
      const q = net.queue; net.queue = [];
      for (const m of q) ws.send(JSON.stringify(m));
      if (net.sentDir) ws.send(JSON.stringify({ type: 'input', dir: net.sentDir }));
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
    const me = r.members.find((x) => x.id === clientId);
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
    for (const p of s.players) {
      const lp = net.lastPos[p.seat];
      if (lp && Math.abs(lp.x - p.x) + Math.abs(lp.y - p.y) === 1) {
        net.anim[p.seat] = { from: { x: lp.x, y: lp.y }, t0: t };
      }
      net.lastPos[p.seat] = { x: p.x, y: p.y };
    }
    meSeat = typeof s.you === 'number' ? s.you : -1;
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
  $('createBtn').addEventListener('click', () => goOnline({ type: 'create', name: myName(), difficulty: soloDiff }));

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

  /* ---------------- Lobby ---------------- */
  const lobbySeg = $('lobbyDiff');
  lobbySeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (net.room && net.room.hostId === clientId) netSend({ type: 'settings', difficulty: b.dataset.d });
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
    const isHost = r.hostId === clientId;
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
        if (m.id === clientId) tags.push('You');
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
    const seats = k === 'solo'
      ? [{ name: 'You' }, { name: 'Bot 1', isBot: true }, { name: 'Bot 2', isBot: true }, { name: 'Bot 3', isBot: true }]
      : [{ name: 'P1' }, { name: 'P2' }];
    G = BG.createGame({ mode: k, difficulty: soloDiff, seats, now });
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
    show('game');
    let label, hint;
    if (kind === 'online') {
      label = net.room ? `Room ${net.room.code}` : 'Online';
      hint = 'Move <kbd>WASD</kbd>/<kbd>Arrows</kbd> · Bomb <kbd>Space</kbd> · Leave <kbd>Esc</kbd>';
    } else if (kind === 'solo') {
      label = `Solo · ${G.difficulty}`;
      hint = 'Move <kbd>WASD</kbd>/<kbd>Arrows</kbd> · Bomb <kbd>Space</kbd> · Menu <kbd>Esc</kbd>';
    } else {
      label = 'Local duel';
      hint = 'P1 <kbd>WASD</kbd> + <kbd>Space</kbd> · P2 <kbd>Arrows</kbd> + <kbd>Enter</kbd> · Menu <kbd>Esc</kbd>';
    }
    $('modeLabel').textContent = label;
    $('hint').innerHTML = hint;
  }
  $('gameExit').addEventListener('click', toMenu);

  function again() {
    if (kind === 'solo' || kind === 'local') startLocal(kind);
    else if (kind === 'online' && net.room && net.room.hostId === clientId) netSend({ type: 'start' });
  }

  /* ---------------- Results overlay ---------------- */
  let overlayShown = false;
  function hideOverlay() { overlayShown = false; $('overlay').classList.add('hidden'); }

  function openOverlay(title, sub, { canAgain, toLobby, leaveText }) {
    overlayShown = true;
    $('resultText').textContent = title;
    $('resultSub').textContent = sub;
    $('againBtn').classList.toggle('hidden', !canAgain);
    $('toLobbyBtn').classList.toggle('hidden', !toLobby);
    $('overlayLeave').textContent = leaveText;
    $('overlayKeys').classList.toggle('hidden', !canAgain);
    $('overlay').classList.remove('hidden');
  }

  function showLocalResult() {
    if (overlayShown) return;
    let title, sub;
    if (G.mode === 'solo') {
      const won = G.players[0].alive;
      title = won ? 'You win!' : 'Blown up';
      sub = won ? `Cleared the room on ${G.difficulty}.` : (G.winner !== null ? `${G.players[G.winner].name} takes it.` : 'Better luck next round.');
    } else {
      title = G.winner === null ? 'Draw' : `${G.players[G.winner].name} wins!`;
      sub = G.winner === null ? 'Both went down together.' : 'Last one standing.';
    }
    openOverlay(title, sub, { canAgain: true, toLobby: false, leaveText: 'Menu' });
  }

  function showOnlineResult() {
    const s = net.snap;
    const r = net.room;
    if (!r) return;
    const isHost = r.hostId === clientId;
    let title = 'Round over', sub = '';
    if (s) {
      const w = s.winner;
      if (w === null) title = 'Draw';
      else if (w === meSeat) title = 'You win!';
      else title = `${s.players[w].name} wins!`;
      if (meSeat < 0) sub = 'You play next round.';
      else if (w !== meSeat) sub = 'Better luck next round.';
      else sub = 'Last one standing.';
    }
    sub += isHost ? '' : ' Waiting for the host…';
    openOverlay(title, sub.trim(), { canAgain: isHost, toLobby: isHost, leaveText: 'Leave' });
  }
  $('overlayLeave').addEventListener('click', toMenu);
  $('againBtn').addEventListener('click', again);
  $('toLobbyBtn').addEventListener('click', () => netSend({ type: 'lobby' }));

  /* ---------------- Input ---------------- */
  const held = { 0: [], 1: [] };
  const heldDir = (seat) => { const h = held[seat]; return h && h.length ? h[h.length - 1] : null; };
  function press(seat, dir) { const h = held[seat]; if (!h.includes(dir)) h.push(dir); syncInput(); }
  function release(seat, dir) { const h = held[seat]; const i = h.indexOf(dir); if (i >= 0) h.splice(i, 1); syncInput(); }
  function clearHeld() { held[0].length = 0; held[1].length = 0; syncInput(); }
  function syncInput() {
    if (kind !== 'online') return;
    const d = heldDir(0);
    if (d !== net.sentDir) { net.sentDir = d; netSend({ type: 'input', dir: d }); }
  }
  function doBomb(seat) {
    if (kind === 'online') netSend({ type: 'bomb' });
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

  // Touch d-pad: slide your thumb between directions without lifting it.
  const dpad = document.querySelector('.dpad');
  let dpadPointer = null;
  function dpadDir(e) {
    const r = dpad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 12) return null;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }
  function setDpad(dir) {
    held[0].length = 0;
    if (dir) held[0].push(dir);
    dpad.querySelectorAll('button').forEach((b) => b.classList.toggle('down', b.dataset.dir === dir));
    syncInput();
  }
  dpad.style.touchAction = 'none';
  dpad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dpadPointer = e.pointerId;
    try { dpad.setPointerCapture(e.pointerId); } catch (err) {}
    setDpad(dpadDir(e));
  });
  dpad.addEventListener('pointermove', (e) => { if (e.pointerId === dpadPointer) setDpad(dpadDir(e)); });
  ['pointerup', 'pointercancel'].forEach((t) => dpad.addEventListener(t, (e) => {
    if (e.pointerId !== dpadPointer) return;
    dpadPointer = null;
    setDpad(null);
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

  /* ---------------- Main loop ---------------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last);
    last = now;

    if (screen === 'game') {
      let view = null, status = null, readyIn = 0, goIn = 0;

      if ((kind === 'solo' || kind === 'local') && G) {
        for (const p of G.players) if (!p.isBot) p.input = heldDir(p.seat);
        BG.step(G, dt, now);
        view = G; status = G.status;
        readyIn = G.readyUntil - now; goIn = G.goUntil - now;
        if (G.status === 'over') showLocalResult();
      } else if (kind === 'online' && net.snap) {
        const s = net.snap, age = now - net.recvAt;
        view = {
          grid: net.grid,
          players: s.players,
          bombs: s.bombs.map((b) => ({ x: b.x, y: b.y, owner: b.owner, left: b.left - age })),
          explosions: s.explosions.map((e) => ({ x: e.x, y: e.y, left: e.left - age })),
          powerups: s.powerups,
          anim: net.anim,
        };
        status = s.status;
        readyIn = s.readyIn - age; goIn = s.goIn - age;
      }

      const size = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      const px = Math.round(size * dpr);
      if (px > 0 && canvas.width !== px) { canvas.width = px; canvas.height = px; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      window.drawBoard(ctx, size, view, now, meSeat);

      if (view) {
        renderHud(view.players);
        if (status === 'ready' && readyIn > 0) setBanner('Ready…');
        else if (goIn > 0) setBanner('Go!');
        else if (kind === 'online' && meSeat < 0 && status !== 'over') setBanner('Watching · you play next round', true);
        else setBanner('');
        const me = view.players[meSeat];
        const mine = me ? view.bombs.filter((b) => b.owner === meSeat).length : 0;
        $('bombBtn').disabled = !(me && me.alive && status === 'playing' && mine < me.maxBombs);
      } else {
        setBanner(kind === 'online' ? 'Loading match…' : '', true);
      }
    }
    requestAnimationFrame(frame);
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

  /* ---------------- Start up ---------------- */
  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (serverUrl()) connect(); else setStatus('No server', 'off');
  if (roomParam) {
    codeInput.value = roomParam;
    history.replaceState(null, '', location.pathname);
    goOnline({ type: 'join', code: roomParam, name: myName() });
  }
})();
