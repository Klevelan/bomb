// Player profile saved on this device: coins, unlocked items, equipped items, rewards.
(function () {
  const KEY = 'bombroom:profile';
  const C = window.Cosmetics;
  const KINDS = ['skin', 'bomb', 'map'];

  // Coin rewards
  const REWARD = {
    played: 5,
    perCrate: 1, maxCrates: 20,
    perKnockout: 5,
    soloWin: { easy: 15, medium: 30, hard: 60 },
    onlineWin: 40, perHumanOpponent: 20,
    localWin: 10,
    dailyFirstWin: 50,
  };

  const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time

  function load() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!p || typeof p !== 'object') p = {};
    p.coins = Number.isFinite(p.coins) ? Math.max(0, Math.floor(p.coins)) : 0;
    p.owned = p.owned && typeof p.owned === 'object' ? p.owned : {};
    p.equipped = p.equipped && typeof p.equipped === 'object' ? p.equipped : {};
    for (const k of KINDS) {
      const list = Array.isArray(p.owned[k]) ? p.owned[k].filter((id) => C.valid(k, id)) : [];
      if (!list.includes(C.DEFAULTS[k])) list.unshift(C.DEFAULTS[k]);
      p.owned[k] = list;
      if (!list.includes(p.equipped[k])) p.equipped[k] = C.DEFAULTS[k];
    }
    p.stats = Object.assign({ played: 0, wins: 0, coinsEarned: 0 }, p.stats || {});
    p.rewarded = Array.isArray(p.rewarded) ? p.rewarded.slice(-30) : [];
    p.lastDailyWin = typeof p.lastDailyWin === 'string' ? p.lastDailyWin : null;
    return p;
  }

  let P = load();
  const listeners = [];
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {}
    for (const fn of listeners) fn(P);
  }

  const Profile = {
    REWARD,
    onChange(fn) { listeners.push(fn); },
    get coins() { return P.coins; },
    get stats() { return P.stats; },
    owns: (kind, id) => P.owned[kind].includes(id),
    equipped: (kind) => P.equipped[kind],
    look: () => ({ skin: P.equipped.skin, bomb: P.equipped.bomb }),

    buy(kind, id) {
      const item = C.CATALOG[kind].find((i) => i.id === id);
      if (!item) return { ok: false, reason: 'Unknown item.' };
      if (Profile.owns(kind, id)) return { ok: true };
      if (P.coins < item.price) return { ok: false, reason: `You need ${item.price - P.coins} more coins.` };
      P.coins -= item.price;
      P.owned[kind].push(id);
      P.equipped[kind] = id;
      save();
      return { ok: true, bought: true };
    },

    equip(kind, id) {
      if (!Profile.owns(kind, id)) return false;
      P.equipped[kind] = id;
      save();
      return true;
    },

    // result: { key, mode, difficulty, won, crates, kills, humanOpponents }
    // Returns { lines: [[label, coins]], total } or null if this match was already paid out.
    award(r) {
      if (r.key && P.rewarded.includes(r.key)) return null;
      const lines = [['Match played', REWARD.played]];
      if (r.mode !== 'local') {
        const c = Math.min(REWARD.maxCrates, r.crates || 0);
        if (c) lines.push([`Crates ×${c}`, c * REWARD.perCrate]);
        if (r.kills) lines.push([`Knockouts ×${r.kills}`, r.kills * REWARD.perKnockout]);
      }
      if (r.won) {
        let w;
        if (r.mode === 'solo') w = REWARD.soloWin[r.difficulty] || REWARD.soloWin.medium;
        else if (r.mode === 'online') w = REWARD.onlineWin + REWARD.perHumanOpponent * (r.humanOpponents || 0);
        else w = REWARD.localWin;
        lines.push(['Victory', w]);
        if (r.mode !== 'local' && P.lastDailyWin !== today()) {
          lines.push(['First win today', REWARD.dailyFirstWin]);
          P.lastDailyWin = today();
        }
        P.stats.wins++;
      }
      const total = lines.reduce((s, l) => s + l[1], 0);
      P.coins += total;
      P.stats.played++;
      P.stats.coinsEarned += total;
      if (r.key) P.rewarded = [...P.rewarded, r.key].slice(-30);
      save();
      return { lines, total };
    },
  };

  window.Profile = Profile;
})();
