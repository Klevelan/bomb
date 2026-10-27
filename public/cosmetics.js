// Shop catalog: character skins, bomb effects and map themes.
// Shared by the browser (shop, drawing) and the server (checks that a skin name is real).
(function (root) {
  const SKINS = [
    { id: 'classic', name: 'Classic', price: 0 },
    { id: 'ember', name: 'Ember', price: 100, body: ['#FF8A4C', '#C2361F'], eyes: 'angry' },
    { id: 'frost', name: 'Frost', price: 100, body: ['#C4ECFF', '#4A90D9'], eyes: 'dots', extra: 'shine' },
    { id: 'toxic', name: 'Toxic', price: 200, body: ['#B6F24A', '#3E9B2E'], eyes: 'dots', extra: 'spots' },
    { id: 'ninja', name: 'Ninja', price: 300, body: ['#454B59', '#1C1F26'], eyes: 'band', band: '#E5484D' },
    { id: 'robot', name: 'Robot', price: 400, body: ['#D3DAE3', '#7D8794'], eyes: 'visor', extra: 'antenna' },
    { id: 'ghost', name: 'Ghost', price: 600, body: ['#FFFFFF', '#C9CFDA'], eyes: 'dots', shape: 'ghost', alpha: 0.9 },
    { id: 'galaxy', name: 'Galaxy', price: 900, body: ['#6A48D8', '#1B1446'], eyes: 'dots', extra: 'stars' },
    { id: 'king', name: 'Gold King', price: 1500, body: ['#FFE07A', '#D99A1E'], eyes: 'dots', extra: 'crown' },
  ];

  // blast = three rgb stops: centre, middle, edge
  const BOMBS = [
    { id: 'classic', name: 'Classic', price: 0, bomb: '#13171E', rim: '#2A3342', spark: '#FF7A4D', blast: ['255,240,196', '255,150,70', '226,62,62'] },
    { id: 'ice', name: 'Ice', price: 150, bomb: '#16324A', rim: '#3D7FB8', spark: '#9FE6FF', blast: ['240,252,255', '120,210,255', '40,110,230'] },
    { id: 'toxic', name: 'Toxic', price: 200, bomb: '#1A2A12', rim: '#4C7A2A', spark: '#B6F24A', blast: ['240,255,200', '150,230,60', '40,140,40'] },
    { id: 'plasma', name: 'Plasma', price: 350, bomb: '#24123A', rim: '#7A3FD1', spark: '#F07CFF', blast: ['255,230,255', '230,110,255', '110,50,230'] },
    { id: 'fire', name: 'Fire', price: 450, bomb: '#2A0E08', rim: '#E2531F', spark: '#FFB13D', blast: ['255,240,180', '255,130,40', '200,40,20'] },
    { id: 'gold', name: 'Gold', price: 600, bomb: '#3A2A0A', rim: '#D9A321', spark: '#FFE07A', blast: ['255,252,220', '255,214,90', '214,140,20'] },
    { id: 'rainbow', name: 'Rainbow', price: 1000, bomb: '#1B1F2A', rim: '#6A7080', spark: '#FFFFFF', rainbow: true, blast: ['255,255,255', '255,150,70', '226,62,62'] },
  ];

  const MAPS = [
    { id: 'dungeon', name: 'Dungeon', price: 0, floorA: '#0C1015', floorB: '#0F141B', wall: '#222A38', wallEdge: '#2E3849', box: '#7B5539', boxTop: '#95663F', boxLine: '#573C27' },
    { id: 'meadow', name: 'Meadow', price: 200, floorA: '#2E5A2A', floorB: '#34632F', wall: '#68707C', wallEdge: '#8A929E', box: '#C9A24A', boxTop: '#E0BC62', boxLine: '#9C7A2E' },
    { id: 'desert', name: 'Desert', price: 250, floorA: '#C29C61', floorB: '#CBA66B', wall: '#8C5A34', wallEdge: '#A8703F', box: '#6E4A2A', boxTop: '#86603A', boxLine: '#4E3420' },
    { id: 'glacier', name: 'Glacier', price: 300, floorA: '#BFDDF0', floorB: '#CBE5F5', wall: '#5E8DB8', wallEdge: '#82AED6', box: '#9FD2F0', boxTop: '#C6E9FB', boxLine: '#6FA7CF' },
    { id: 'volcano', name: 'Volcano', price: 450, floorA: '#1A0F0E', floorB: '#211312', wall: '#3A2422', wallEdge: '#8C3A1E', box: '#4A2C26', boxTop: '#5E3A31', boxLine: '#2E1A16', glow: 'rgba(255,90,42,0.45)' },
    { id: 'neon', name: 'Neon', price: 700, floorA: '#07060F', floorB: '#0A0816', wall: '#100B26', wallEdge: '#00E5FF', box: '#1A0C2C', boxTop: '#2A1240', boxLine: '#FF3DCB', glow: '#00E5FF' },
  ];

  const CATALOG = { skin: SKINS, bomb: BOMBS, map: MAPS };
  const DEFAULTS = { skin: 'classic', bomb: 'classic', map: 'dungeon' };
  const byId = (kind, id) => CATALOG[kind].find((i) => i.id === id) || CATALOG[kind][0];
  const valid = (kind, id) => CATALOG[kind].some((i) => i.id === id);

  const api = { SKINS, BOMBS, MAPS, CATALOG, DEFAULTS, byId, valid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cosmetics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
