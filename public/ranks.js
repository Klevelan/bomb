// Rank tiers by rating. Shared by the browser and the server.
(function (root) {
  const START_RATING = 1000;
  const TIERS = [
    { name: 'Bronze', min: -Infinity, color: '#C98A55' },
    { name: 'Silver', min: 1000, color: '#B7C2D0' },
    { name: 'Gold', min: 1150, color: '#FFC53D' },
    { name: 'Platinum', min: 1300, color: '#5FE0D0' },
    { name: 'Diamond', min: 1450, color: '#7AB8FF' },
    { name: 'Master', min: 1600, color: '#D58CFF' },
  ];
  function tierFor(rating) {
    let t = TIERS[0];
    for (const tier of TIERS) if (rating >= tier.min) t = tier;
    return t;
  }
  function nextTier(rating) {
    return TIERS.find((t) => t.min > rating) || null;
  }

  // Elo for free-for-all: every pair of human players counts as one duel, decided by
  // who lasted longer (place 1 = winner). K is shared out across opponents.
  function rateMatch(players, K = 32) {
    const n = players.length;
    return players.map((a) => {
      if (n < 2) return 0;
      let d = 0;
      for (const b of players) {
        if (a === b) continue;
        const score = a.place < b.place ? 1 : a.place === b.place ? 0.5 : 0;
        const expected = 1 / (1 + Math.pow(10, (b.rating - a.rating) / 400));
        d += (K * (score - expected)) / (n - 1);
      }
      return Math.round(d);
    });
  }

  const api = { START_RATING, TIERS, tierFor, nextTier, rateMatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ranks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
