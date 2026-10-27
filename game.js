'use strict';
/*
 * Bloomfall — Space Marines hold a hive world against a Tyranid swarm.
 * Plain canvas + DOM, no dependencies. The simulation runs on a fixed 60 Hz tick;
 * rendering happens once per animation frame.
 */
(() => {
  const W = 960, H = 600, TAU = Math.PI * 2;
  const FINAL_WAVE = 40;
  const START_MONEY = 800;
  const START_LIVES = 100;
  const MODEL_SCALE = 1.3; // squad miniatures are drawn larger than their footprint math
  const UNIT_SCALE = 1.2;

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- utilities
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  }
  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    const k = clamp(l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0, 0, 1);
    return Math.hypot(px - (x1 + dx * k), py - (y1 + dy * k));
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
  }
  function blob(c, x, y, rx, ry, fill) {
    c.fillStyle = fill;
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill();
  }
  function dot(c, x, y, r, fill) {
    c.fillStyle = fill;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }

  // -------------------------------------------------------------------- paths
  // Ground units walk the long road; fliers take a shorter lane across the sky.
  function makePath(pts, gateCut) {
    const segs = [];
    let len = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const l = Math.hypot(x2 - x1, y2 - y1);
      segs.push({ x1, y1, x2, y2, len: l, start: len, ang: Math.atan2(y2 - y1, x2 - x1) });
      len += l;
    }
    return { pts, segs, len, end: len - gateCut };
  }
  const GROUND = makePath([
    [-40, 90], [200, 90], [200, 270], [70, 270], [70, 500], [380, 500],
    [380, 160], [580, 160], [580, 430], [790, 430], [790, 110], [1000, 110],
  ], 100);
  const AIR = makePath([[-40, 340], [250, 200], [520, 330], [760, 215], [1000, 110]], 110);
  const PATH_W = 46;

  function posAt(path, d) {
    const s0 = path.segs[0];
    if (d <= 0) return { x: s0.x1 + Math.cos(s0.ang) * d, y: s0.y1 + Math.sin(s0.ang) * d, ang: s0.ang };
    for (const s of path.segs) {
      if (d <= s.start + s.len) {
        const k = (d - s.start) / s.len;
        return { x: s.x1 + (s.x2 - s.x1) * k, y: s.y1 + (s.y2 - s.y1) * k, ang: s.ang };
      }
    }
    const s = path.segs[path.segs.length - 1];
    return { x: s.x2, y: s.y2, ang: s.ang };
  }
  function distToGround(x, y) {
    let m = Infinity;
    for (const s of GROUND.segs) m = Math.min(m, segDist(x, y, s.x1, s.y1, s.x2, s.y2));
    return m;
  }

  // ------------------------------------------------------------------ chapters
  const CHAPTERS = {
    ultramarines: { name: 'Ultramarines', armour: '#1f4fa3', trim: '#d4af37', mark: '#e8e8e8' },
    bloodangels: { name: 'Blood Angels', armour: '#9c1414', trim: '#d4af37', mark: '#151515' },
    darkangels: { name: 'Dark Angels', armour: '#1d4a2a', trim: '#c9b37e', mark: '#e8e0c8' },
    imperialfists: { name: 'Imperial Fists', armour: '#e0ad1c', trim: '#2a2a2a', mark: '#9c1414' },
    spacewolves: { name: 'Space Wolves', armour: '#6f8596', trim: '#d4af37', mark: '#c9a24a' },
    blacktemplars: { name: 'Black Templars', armour: '#1f1f22', trim: '#e8e8e8', mark: '#e8e8e8' },
  };
  let chapter = 'ultramarines';
  try { const c = localStorage.getItem('bloomfall-chapter'); if (CHAPTERS[c]) chapter = c; } catch (e) { /* storage unavailable */ }

  // ------------------------------------------------------------------ tyranids
  // armour: each point above a weapon's AP removes one damage. threat: wave-budget cost.
  const UNITS = {
    ripper: { name: 'Ripper Swarm', hp: 3, speed: 0.9, r: 8, armour: 0, bounty: 1, leak: 1, threat: 1, gait: 0.35, unlock: 1, spacing: 14, note: 'Swarm' },
    termagant: { name: 'Termagant', hp: 5, speed: 1.15, r: 8, armour: 0, bounty: 2, leak: 1, threat: 1.5, gait: 0.3, unlock: 1, spacing: 20, note: 'Swarm' },
    hormagaunt: { name: 'Hormagaunt', hp: 6, speed: 1.9, r: 8, armour: 0, bounty: 2, leak: 1, threat: 2, gait: 0.45, unlock: 3, spacing: 16, note: 'Fast swarm' },
    gargoyle: { name: 'Gargoyle', hp: 5, speed: 1.5, r: 9, armour: 0, bounty: 3, leak: 2, threat: 2.5, fly: true, gait: 0.35, unlock: 6, spacing: 24, note: 'Flying' },
    genestealer: { name: 'Genestealer', hp: 16, speed: 2.2, r: 9, armour: 1, bounty: 6, leak: 3, threat: 6, gait: 0.5, unlock: 5, spacing: 40, note: 'Elite, very fast, armour 1' },
    warrior: { name: 'Tyranid Warrior', hp: 45, speed: 1.05, r: 12, armour: 1, bounty: 12, leak: 3, threat: 15, synapse: true, gait: 0.22, unlock: 8, spacing: 110, note: 'Elite, synapse: speeds up nearby swarm' },
    carnifex: { name: 'Carnifex', hp: 140, speed: 0.75, r: 16, armour: 3, bounty: 40, leak: 10, threat: 45, gait: 0.12, unlock: 10, spacing: 180, note: 'Monster, armour 3' },
    lictor: { name: 'Lictor', hp: 40, speed: 1.4, r: 11, armour: 1, bounty: 14, leak: 3, threat: 15, camo: true, gait: 0.25, unlock: 12, spacing: 120, note: 'Elite, camouflaged' },
    zoanthrope: { name: 'Zoanthrope', hp: 36, speed: 0.85, r: 11, armour: 0, bounty: 14, leak: 3, threat: 14, ward: true, synapse: true, gait: 0.05, unlock: 14, spacing: 110, note: 'Warp field halves non-psychic damage' },
    harpy: { name: 'Harpy', hp: 70, speed: 1.25, r: 16, armour: 1, bounty: 22, leak: 6, threat: 26, fly: true, gait: 0.15, unlock: 16, spacing: 140, note: 'Flying monster, armour 1' },
    tervigon: { name: 'Tervigon', hp: 320, speed: 0.5, r: 21, armour: 2, bounty: 70, leak: 15, threat: 90, synapse: true, spawns: 'termagant', spawnEvery: 150, gait: 0.08, unlock: 18, spacing: 300, note: 'Spawns Termagants, armour 2' },
    tyrant: { name: 'Hive Tyrant', hp: 1400, speed: 0.65, r: 21, armour: 3, bounty: 250, leak: 40, threat: 0, synapse: true, boss: true, gait: 0.1, note: 'Boss, armour 3, synapse' },
    titan: { name: 'Hierophant Bio-Titan', hp: 6000, speed: 0.38, r: 36, armour: 4, bounty: 1000, leak: 999, threat: 0, synapse: true, boss: true, spawns: 'hormagaunt', spawnEvery: 90, gait: 0.06, note: 'Boss, armour 4' },
  };
  for (const k in UNITS) UNITS[k].key = k;

  const INTROS = {
    hormagaunt: 'Hormagaunts: fast and numerous.',
    genestealer: 'Genestealers: elite and very fast, with armour 1.',
    gargoyle: 'Gargoyles fly straight across the sky. Whirlwinds and Dreadnought fists cannot hit them.',
    warrior: 'Tyranid Warriors are synapse creatures. Nearby swarm creatures move faster until they die.',
    carnifex: 'Carnifex: armour 3 shrugs off low-AP weapons. Bring plasma, missiles or psychic power.',
    lictor: 'Lictors are camouflaged. Only Librarians and units with auspex gear can target them.',
    zoanthrope: 'Zoanthropes: their warp field halves all non-psychic damage.',
    harpy: 'Harpies: armoured fliers. Flakk missiles hit them hard.',
    tervigon: 'Tervigons birth Termagants as they walk.',
    tyrant: 'A Hive Tyrant leads the swarm.',
    titan: 'The Hierophant Bio-Titan. Everything you have.',
  };

  // -------------------------------------------------------------------- waves
  // [unit, count, spacing in ticks]
  const EARLY_WAVES = {
    1: [['termagant', 12, 40]],
    2: [['termagant', 18, 30], ['ripper', 8, 40]],
    3: [['hormagaunt', 10, 34], ['termagant', 16, 24]],
    4: [['ripper', 24, 14], ['hormagaunt', 14, 26]],
    5: [['termagant', 26, 18], ['genestealer', 3, 80]],
    6: [['gargoyle', 10, 34], ['termagant', 20, 20]],
    7: [['hormagaunt', 26, 15], ['genestealer', 6, 55]],
    8: [['warrior', 2, 200], ['termagant', 30, 14]],
    9: [['gargoyle', 18, 22], ['genestealer', 8, 45]],
    10: [['carnifex', 1, 0], ['hormagaunt', 30, 12]],
    11: [['warrior', 4, 120], ['gargoyle', 16, 20], ['termagant', 30, 10]],
    12: [['lictor', 3, 140], ['genestealer', 12, 30]],
  };

  function waveGroups(n) {
    if (EARLY_WAVES[n]) return EARLY_WAVES[n];
    const rng = mulberry32(n * 7919 + 13);
    const pool = Object.keys(UNITS)
      .filter((k) => !UNITS[k].boss && UNITS[k].unlock <= n)
      .sort((a, b) => UNITS[a].threat - UNITS[b].threat);
    const budget = 130 * Math.pow(1.1, n - 12);
    // Every wave leads with a big swarm; the rest of the budget buys elites and monsters.
    const swarm = pool.filter((k) => UNITS[k].threat <= 2.5);
    const elite = pool.filter((k) => UNITS[k].threat > 2.5);
    const groupCount = 1 + Math.floor(rng() * 3);
    const groups = [];
    for (let i = 0; i <= groupCount; i++) {
      const k = i === 0 ? swarm[Math.floor(rng() * swarm.length)] : elite[Math.floor(Math.pow(rng(), 0.8) * elite.length)];
      const u = UNITS[k];
      const share = i === 0 ? 0.5 : 0.5 / groupCount;
      const count = clamp(Math.round((budget * share) / u.threat), 1, 90);
      const spacing = Math.round(u.spacing * (0.6 + rng() * 0.6) * Math.max(0.45, 1 - (n - 12) * 0.015));
      groups.push([k, count, spacing]);
    }
    if (n === 20) groups.push(['tyrant', 1, 0]);
    if (n === 30) groups.push(['tyrant', 2, 600]);
    if (n === 35) groups.push(['tervigon', 3, 240], ['tyrant', 1, 0]);
    if (n === FINAL_WAVE) groups.push(['titan', 1, 0]);
    if (n > FINAL_WAVE && n % 10 === 0) groups.push(['titan', Math.floor((n - 30) / 10), 900]);
    else if (n > FINAL_WAVE && n % 5 === 0) groups.push(['tyrant', 2, 400]);
    return groups;
  }

  function buildSchedule(n) {
    const out = [];
    let start = 0;
    for (const [key, count, spacing] of waveGroups(n)) {
      for (let i = 0; i < count; i++) out.push({ at: start + i * spacing, key });
      start += Math.max(60, count * spacing * 0.6);
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // ------------------------------------------------------------- space marines
  // A tower's stats are rebuilt from `base` + trunk upgrade + owned nodes of its chosen doctrine.
  // Each weapon in `w` fires on its own cooldown.
  const TOWERS = {
    scouts: {
      name: 'Scout Squad', short: 'Scouts', key: '1', cost: 200, r: 19,
      blurb: 'Cheap skirmishers. Train them as snipers or shotgun brawlers.',
      formation: [[-6, -7], [7, -3], [-2, 8]],
      base: { w: [{ label: 'Bolt pistols', kind: 'proj', style: 'bolt', range: 115, rate: 30, dmg: 2, ap: 0, speed: 11, air: true }] },
      trunk: { name: 'Scout Sergeant', cost: 120, desc: '+1 damage, +15 range.', apply: (s) => { s.w[0].dmg += 1; s.w[0].range += 15; } },
      look: (t) => {
        const weapon = t.path === 0 ? 'sniper' : t.path === 1 ? 'shotgun' : 'boltpistol';
        return [0, 1, 2].map(() => ({ kind: 'scout', weapon, cloak: t.path === 0 && t.lv >= 2 }));
      },
      paths: [
        { name: 'Sniper', nodes: [
          { name: 'Sniper Rifles', cost: 160, desc: 'Precise long shots: +5 damage, AP 1, +140 range.', apply: (s) => { Object.assign(s.w[0], { label: 'Sniper rifles', kind: 'snipe', dmg: s.w[0].dmg + 5, ap: 1, rate: 75 }); s.w[0].range += 140; } },
          { name: 'Camo Cloaks', cost: 240, desc: 'Spots camouflaged Lictors. +3 damage.', apply: (s) => { s.camo = true; s.w[0].dmg += 3; } },
          { name: 'Master Marksmen', cost: 950, desc: '+14 damage, +2 AP, fires 30% faster.', apply: (s) => { s.w[0].dmg += 14; s.w[0].ap += 2; s.w[0].rate *= 0.7; } },
        ] },
        { name: 'Close Quarters', nodes: [
          { name: 'Astartes Shotguns', cost: 150, desc: 'Three pellets per shot.', apply: (s) => { Object.assign(s.w[0], { label: 'Astartes shotguns', count: 3, spread: 0.22, style: 'pellet' }); s.w[0].range -= 15; } },
          { name: 'Frag Grenades', cost: 280, desc: 'Pellets burst on impact for splash damage.', apply: (s) => { s.w[0].splash = 20; } },
          { name: 'Veteran Scouts', cost: 800, desc: 'Five pellets, +1 damage, fires 35% faster.', apply: (s) => { s.w[0].count = 5; s.w[0].spread = 0.3; s.w[0].dmg += 1; s.w[0].rate *= 0.65; } },
        ] },
      ],
    },
    tactical: {
      name: 'Tactical Squad', short: 'Tacticals', key: '2', cost: 380, r: 20,
      blurb: 'Bolter-armed battle-brothers. Drill their bolters or add special and heavy weapons.',
      formation: [[-7, -7], [8, -2], [-3, 8]],
      base: { w: [{ label: 'Boltguns', kind: 'proj', style: 'bolt', range: 140, rate: 20, dmg: 2, ap: 0, speed: 12, air: true }] },
      trunk: { name: 'Veteran Sergeant', cost: 200, desc: '+1 damage, +15 range.', apply: (s) => { s.w[0].dmg += 1; s.w[0].range += 15; } },
      look: (t) => {
        const head = t.path === 0 && t.lv >= 3 ? 'vet' : '';
        return [
          { weapon: t.path === 1 && t.lv >= 2 ? 'missile' : 'bolter', head },
          { weapon: 'bolter', head },
          { weapon: t.path === 1 ? 'flamer' : 'bolter', head },
        ];
      },
      paths: [
        { name: 'Bolter Drill', nodes: [
          { name: 'Bolter Drill', cost: 260, desc: 'Fires 30% faster.', apply: (s) => { s.w[0].rate *= 0.7; } },
          { name: 'Kraken Rounds', cost: 420, desc: '+1 AP, +25 range.', apply: (s) => { s.w[0].ap += 1; s.w[0].range += 25; } },
          { name: 'Sternguard Veterans', cost: 1500, desc: '+3 damage, +1 AP, sees camouflage.', apply: (s) => { s.w[0].dmg += 3; s.w[0].ap += 1; s.camo = true; s.w[0].label = 'Special-issue boltguns'; } },
        ] },
        { name: 'Heavy Weapons', nodes: [
          { name: 'Flamer', cost: 300, desc: 'Adds a flamer that scorches nearby swarms.', apply: (s) => { s.w.push({ label: 'Flamer', kind: 'flame', range: 72, rate: 30, dmg: 2, ap: 0, cone: 0.6, hits: 8, air: false }); } },
          { name: 'Missile Launcher', cost: 550, desc: 'Adds homing krak missiles: 10 damage, AP 2, splash.', apply: (s) => { s.w.push({ label: 'Missile launcher', kind: 'proj', style: 'missile', homing: true, range: 210, rate: 90, dmg: 10, ap: 2, splash: 26, speed: 6, air: true }); } },
          { name: 'Combat Doctrines', cost: 1200, desc: 'Flamer and missiles fire 40% faster, +4 damage.', apply: (s) => { for (const w of s.w.slice(1)) { w.rate *= 0.6; w.dmg += 4; } } },
        ] },
      ],
    },
    devastators: {
      name: 'Devastator Squad', short: 'Devastators', key: '3', cost: 600, r: 21,
      blurb: 'Heavy bolters shred the swarm. Or refit with missiles for monsters and fliers.',
      formation: [[-7, -7], [8, -2], [-3, 8]],
      base: { w: [{ label: 'Heavy bolters', kind: 'proj', style: 'hbolt', range: 170, rate: 8, dmg: 2, ap: 1, speed: 13, spread: 0.05, air: true }] },
      trunk: { name: 'Armorium Cherub', cost: 250, desc: 'Fires 15% faster.', apply: (s) => { s.w[0].rate *= 0.85; } },
      look: (t) => [0, 1, 2].map(() => ({ weapon: t.path === 1 ? 'missile' : 'heavybolter' })),
      paths: [
        { name: 'Heavy Bolters', nodes: [
          { name: 'Hellfire Rounds', cost: 380, desc: '+1 damage.', apply: (s) => { s.w[0].dmg += 1; } },
          { name: 'Signum Array', cost: 400, desc: '+40 range, sees camouflage.', apply: (s) => { s.w[0].range += 40; s.camo = true; } },
          { name: 'Suspensor Fire', cost: 1700, desc: 'Fires 45% faster, rounds pierce 2 foes.', apply: (s) => { s.w[0].rate *= 0.55; s.w[0].pierce = 2; } },
        ] },
        { name: 'Missile Launchers', nodes: [
          { name: 'Krak & Frag Missiles', cost: 450, desc: 'Swap to homing missiles: 8 damage, AP 2, splash.', apply: (s) => { Object.assign(s.w[0], { label: 'Missile launchers', style: 'missile', homing: true, rate: 45, splash: 30, speed: 6.5, spread: 0, dmg: s.w[0].dmg + 6, ap: 2 }); s.w[0].range += 50; } },
          { name: 'Flakk Missiles', cost: 500, desc: 'Triple damage against flying creatures.', apply: (s) => { s.w[0].airMul = 3; } },
          { name: 'Cyclone Launchers', cost: 1800, desc: 'Two missiles per volley, +4 damage, fires 40% faster.', apply: (s) => { s.w[0].count = 2; s.w[0].spread = 0.25; s.w[0].dmg += 4; s.w[0].rate *= 0.6; } },
        ] },
      ],
    },
    assault: {
      name: 'Assault Squad', short: 'Assault', key: '4', cost: 550, r: 20,
      blurb: 'Jump-pack marines leap onto the swarm with chainswords. Can strike fliers.',
      formation: [[-6, -6], [7, -2], [-2, 7]],
      base: { w: [{ label: 'Chainswords', kind: 'leap', range: 110, rate: 70, dmg: 6, ap: 1, splash: 24, hits: 4, air: true }] },
      trunk: { name: 'Jump Pack Drill', cost: 250, desc: '+25 leap range.', apply: (s) => { s.w[0].range += 25; } },
      look: (t) => {
        const dc = t.path === 1 && t.lv >= 3;
        const weapon = t.path === 0 ? (t.lv >= 3 ? 'hammer' : 'claws') : 'chainsword';
        return [0, 1, 2].map(() => ({ pack: 'jump', weapon, armour: dc ? '#161616' : null, trim: dc ? '#b01818' : null }));
      },
      paths: [
        { name: 'Vanguard Veterans', nodes: [
          { name: 'Lightning Claws', cost: 350, desc: '+4 damage, strikes 2 more foes.', apply: (s) => { s.w[0].dmg += 4; s.w[0].hits += 2; s.w[0].label = 'Lightning claws'; } },
          { name: 'Relic Blades', cost: 650, desc: '+5 damage, +2 AP.', apply: (s) => { s.w[0].dmg += 5; s.w[0].ap += 2; } },
          { name: 'Thunder Hammers', cost: 2100, desc: '+25 damage. Stuns what it hits.', apply: (s) => { s.w[0].dmg += 25; s.w[0].stun = 50; s.w[0].label = 'Thunder hammers'; } },
        ] },
        { name: 'Death from Above', nodes: [
          { name: 'Overcharged Packs', cost: 300, desc: '+50 leap range, leaps 20% more often.', apply: (s) => { s.w[0].range += 50; s.w[0].rate *= 0.8; } },
          { name: 'Hammer of Wrath', cost: 700, desc: 'Bigger landing: +18 radius, strikes 4 more foes.', apply: (s) => { s.w[0].splash += 18; s.w[0].hits += 4; } },
          { name: 'Death Company', cost: 1800, desc: 'Leaps twice as often, +6 damage.', apply: (s) => { s.w[0].rate *= 0.5; s.w[0].dmg += 6; } },
        ] },
      ],
    },
    hellblasters: {
      name: 'Hellblaster Squad', short: 'Hellblasters', key: '5', cost: 800, r: 20,
      blurb: 'Plasma incinerators: heavy hits with high AP. Monster hunters.',
      formation: [[-7, -7], [8, -2], [-3, 8]],
      base: { w: [{ label: 'Plasma incinerators', kind: 'proj', style: 'plasma', range: 160, rate: 50, dmg: 9, ap: 3, speed: 9, air: true }] },
      trunk: { name: 'Plasma Calibration', cost: 300, desc: '+2 damage.', apply: (s) => { s.w[0].dmg += 2; } },
      look: () => [0, 1, 2].map(() => ({ weapon: 'plasma' })),
      paths: [
        { name: 'Supercharge', nodes: [
          { name: 'Supercharged Coils', cost: 450, desc: '+7 damage.', apply: (s) => { s.w[0].dmg += 7; } },
          { name: 'Plasma Burst', cost: 700, desc: 'Bolts burst on impact for splash damage.', apply: (s) => { s.w[0].splash = 24; } },
          { name: 'Heavy Incinerators', cost: 2400, desc: '+25 damage, +1 AP, +30 range.', apply: (s) => { s.w[0].dmg += 25; s.w[0].ap += 1; s.w[0].range += 30; } },
        ] },
        { name: 'Assault Plasma', nodes: [
          { name: 'Assault Incinerators', cost: 400, desc: 'Fires 40% faster.', apply: (s) => { s.w[0].rate *= 0.6; } },
          { name: 'Overcharged Bolts', cost: 700, desc: 'Bolts pierce through 3 foes.', apply: (s) => { s.w[0].pierce = 3; } },
          { name: 'Sustained Volley', cost: 2000, desc: 'Three bolts per volley.', apply: (s) => { s.w[0].count = 3; s.w[0].spread = 0.12; } },
        ] },
      ],
    },
    librarian: {
      name: 'Librarian', short: 'Librarian', key: '6', cost: 950, r: 17,
      blurb: 'Battle psyker. Chain lightning ignores armour and sees camouflage.',
      formation: [[0, 0]],
      base: { camo: true, w: [{ label: 'Smite', kind: 'chain', range: 140, rate: 55, dmg: 4, ap: 9, chain: 4, psychic: true, air: true }] },
      trunk: { name: 'Psychic Hood', cost: 300, desc: '+20 range.', apply: (s) => { s.w[0].range += 20; } },
      look: () => [{ weapon: 'staff', pack: 'psy', armour: '#2a52b0', scale: 1.2 }],
      paths: [
        { name: 'Smite', nodes: [
          { name: 'Psychic Scourge', cost: 450, desc: 'Arcs to 3 more foes.', apply: (s) => { s.w[0].chain += 3; } },
          { name: 'Warp Lightning', cost: 750, desc: '+5 damage.', apply: (s) => { s.w[0].dmg += 5; } },
          { name: 'Chief Librarian', cost: 2600, desc: 'Arcs to 6 more foes, +8 damage, 30% faster.', apply: (s) => { s.w[0].chain += 6; s.w[0].dmg += 8; s.w[0].rate *= 0.7; } },
        ] },
        { name: 'Telepathy', nodes: [
          { name: 'Veil of Time', cost: 400, desc: 'Lightning slows foes by half.', apply: (s) => { s.w[0].slow = { mul: 0.5, t: 45 }; } },
          { name: 'Null Zone', cost: 900, desc: 'Foes in range lose 2 armour and their synapse.', apply: (s) => { s.nullZone = 2; } },
          { name: 'Vortex of Doom', cost: 2200, desc: 'Adds a warp vortex: 60 damage blast every 4 seconds.', apply: (s) => { s.w.push({ label: 'Vortex of Doom', kind: 'blast', range: 160, rate: 240, dmg: 60, ap: 9, splash: 45, psychic: true, air: true }); } },
        ] },
      ],
    },
    whirlwind: {
      name: 'Whirlwind', short: 'Whirlwind', key: '7', cost: 850, r: 25,
      blurb: 'Rhino-chassis missile artillery. Huge range and splash. Cannot hit fliers.',
      base: { w: [{ label: 'Vengeance launcher', kind: 'shell', range: 320, rate: 110, dmg: 5, ap: 0, splash: 48, hits: 20, flight: 45, air: false }] },
      trunk: { name: 'Auspex Targeting', cost: 300, desc: '+40 range.', apply: (s) => { s.w[0].range += 40; } },
      paths: [
        { name: 'Vengeance', nodes: [
          { name: 'Heavy Warheads', cost: 400, desc: '+4 damage, +1 AP.', apply: (s) => { s.w[0].dmg += 4; s.w[0].ap += 1; } },
          { name: 'Wide Barrage', cost: 500, desc: '+18 blast radius, hits 12 more foes.', apply: (s) => { s.w[0].splash += 18; s.w[0].hits += 12; } },
          { name: 'Triple Salvo', cost: 2200, desc: 'Fires three missiles per salvo.', apply: (s) => { s.w[0].count = 3; } },
        ] },
        { name: 'Castellan', nodes: [
          { name: 'Incendiary Warheads', cost: 450, desc: 'Leaves burning ground that ignores armour.', apply: (s) => { s.w[0].burn = { dmg: 1, every: 12, life: 180 }; s.w[0].label = 'Castellan launcher'; } },
          { name: 'Rapid Reload', cost: 600, desc: 'Fires 40% faster.', apply: (s) => { s.w[0].rate *= 0.6; } },
          { name: 'Hellstorm Payload', cost: 1800, desc: 'Fires burn 3× hotter for longer. +80 range.', apply: (s) => { s.w[0].burn.dmg = 3; s.w[0].burn.life = 240; s.w[0].range += 80; } },
        ] },
      ],
    },
    dreadnought: {
      name: 'Redemptor Dreadnought', short: 'Dreadnought', key: '8', cost: 1500, r: 23,
      blurb: 'Walking war machine. Its fist smashes monsters; its gatling handles the rest.',
      base: { w: [
        { label: 'Redemptor fist', kind: 'smash', range: 62, rate: 55, dmg: 18, ap: 3, splash: 30, hits: 6, air: false },
        { label: 'Onslaught gatling', kind: 'proj', style: 'hbolt', range: 150, rate: 10, dmg: 2, ap: 1, speed: 13, spread: 0.08, air: true },
      ] },
      trunk: { name: 'Machine Spirit', cost: 500, desc: 'All weapons fire 20% faster.', apply: (s) => { for (const w of s.w) w.rate *= 0.8; } },
      paths: [
        { name: 'Firepower', nodes: [
          { name: 'Overcharged Gatling', cost: 600, desc: 'Gatling fires 40% faster, +1 damage.', apply: (s) => { s.w[1].rate *= 0.6; s.w[1].dmg += 1; } },
          { name: 'Icarus Rocket Pod', cost: 700, desc: 'Adds anti-air rockets: triple damage to fliers.', apply: (s) => { s.w.push({ label: 'Icarus rockets', kind: 'proj', style: 'missile', homing: true, range: 240, rate: 60, dmg: 10, ap: 2, airMul: 3, speed: 7, air: true }); } },
          { name: 'Macro Plasma', cost: 2600, desc: 'Adds a macro plasma incinerator: 30 damage, AP 4, splash.', apply: (s) => { s.w.push({ label: 'Macro plasma', kind: 'proj', style: 'plasma', range: 190, rate: 40, dmg: 30, ap: 4, splash: 30, speed: 8, air: true }); } },
        ] },
        { name: 'Close Assault', nodes: [
          { name: 'Fist Servos', cost: 500, desc: 'Fist +15 damage.', apply: (s) => { s.w[0].dmg += 15; } },
          { name: 'Heavy Flamer', cost: 650, desc: 'Adds a heavy flamer for crowds.', apply: (s) => { s.w.push({ label: 'Heavy flamer', kind: 'flame', range: 85, rate: 20, dmg: 3, ap: 1, cone: 0.7, hits: 12, air: false }); } },
          { name: 'Venerable Ancient', cost: 2400, desc: 'Fist +30 damage, wider impact, stuns.', apply: (s) => { s.w[0].dmg += 30; s.w[0].splash += 15; s.w[0].stun = 60; } },
        ] },
      ],
    },
    chaplain: {
      name: 'Chaplain', short: 'Chaplain', key: '9', cost: 750, r: 17,
      blurb: 'Litanies make nearby marines fire 12% faster. Fights with his crozius.',
      formation: [[0, 0]],
      base: {
        aura: { radius: 120, rate: 0.88, dmg: 0, ap: 0, camo: false, rangeMul: 1 },
        w: [{ label: 'Crozius arcanum', kind: 'smash', range: 48, rate: 45, dmg: 6, ap: 2, splash: 0, hits: 1, air: false }],
      },
      trunk: { name: 'Rosarius', cost: 300, desc: '+25 aura radius.', apply: (s) => { s.aura.radius += 25; } },
      look: () => [{ weapon: 'crozius', head: 'skull', armour: '#18181a', trim: '#d4af37', scale: 1.2 }],
      paths: [
        { name: 'Litanies', nodes: [
          { name: 'Litany of Hate', cost: 400, desc: 'Nearby marines +1 damage.', apply: (s) => { s.aura.dmg = 1; } },
          { name: 'Exhortation of Rage', cost: 900, desc: 'Nearby marines fire 25% faster.', apply: (s) => { s.aura.rate = 0.75; } },
          { name: 'Master of Sanctity', cost: 2500, desc: 'Nearby marines +2 damage, +1 AP, +15% range.', apply: (s) => { s.aura.dmg = 2; s.aura.ap = 1; s.aura.rangeMul = 1.15; } },
        ] },
        { name: 'Spiritual Leader', nodes: [
          { name: 'Litany of Faith', cost: 300, desc: '+40 aura radius.', apply: (s) => { s.aura.radius += 40; } },
          { name: 'Holy Auspex', cost: 600, desc: 'Nearby marines see camouflage.', apply: (s) => { s.aura.camo = true; } },
          { name: 'Crozius of Wrath', cost: 1500, desc: 'Crozius +30 damage, stuns, hits 4 foes.', apply: (s) => { const w = s.w[0]; w.dmg += 30; w.stun = 40; w.range += 20; w.splash = 22; w.hits = 4; } },
        ] },
      ],
    },
  };
  const TOWER_KEYS = Object.keys(TOWERS);
  const TARGET_MODES = ['first', 'last', 'strong', 'close'];

  // -------------------------------------------------------------------- state
  let state;
  let nextId = 1;
  function newState() {
    return {
      money: START_MONEY, lives: START_LIVES, wave: 0,
      waveActive: false, queue: [], waveTick: 0, time: 0,
      speed: 1, paused: false, auto: false, autoTimer: 0,
      over: false, won: false, freeplay: false, seen: new Set(), shake: 0,
      enemies: [], towers: [], projectiles: [], shells: [], zones: [],
      fx: [], particles: [], floats: [], decals: [],
    };
  }
  let selected = null;
  let placing = null;
  let hover = { x: -999, y: -999, inside: false };

  // -------------------------------------------------------------------- audio
  let actx = null, muted = false;
  const lastSfx = {};
  function ensureAudio() {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  }
  function throttle(key, ms) {
    const now = performance.now();
    if (now - (lastSfx[key] || 0) < ms) return false;
    lastSfx[key] = now;
    return true;
  }
  function tone(freq, dur, type, vol, slide) {
    if (!actx || muted) return;
    const t0 = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, freq) {
    if (!actx || muted) return;
    const len = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
    src.connect(f).connect(g).connect(actx.destination);
    src.start();
  }
  const sfx = {
    bolt() { if (throttle('bolt', 45)) noise(0.06, 0.06, 1800); },
    squelch() { if (throttle('sq', 40)) tone(rand(160, 260), 0.09, 'triangle', 0.05, 0.4); },
    clang() { if (throttle('clang', 120)) tone(380, 0.08, 'square', 0.02, 1.6); },
    boom() { if (throttle('boom', 60)) noise(0.4, 0.22, 380); },
    plasma() { if (throttle('plasma', 60)) tone(900, 0.18, 'sawtooth', 0.025, 0.3); },
    missile() { if (throttle('missile', 80)) noise(0.25, 0.06, 2400); },
    arc() { if (throttle('arc', 60)) noise(0.12, 0.08, 3000); },
    snipe() { if (throttle('snipe', 60)) tone(1600, 0.08, 'square', 0.02, 0.2); },
    smash() { if (throttle('smash', 60)) noise(0.2, 0.2, 200); },
    flame() { if (throttle('flame', 90)) noise(0.15, 0.04, 900); },
    leak() { tone(120, 0.45, 'sawtooth', 0.06, 0.5); },
    place() { tone(260, 0.12, 'square', 0.04, 1.6); },
    horn() { tone(98, 0.6, 'sawtooth', 0.05, 1.02); tone(147, 0.6, 'sawtooth', 0.03, 1.02); },
  };

  // ------------------------------------------------------------------ effects
  const ICHOR = ['#7a2d6a', '#5c8a2a', '#9a3a7a', '#4a6a1a'];
  function burst(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = rand(0.5, spd);
      state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(14, 26), max: 26, color: color || ICHOR[i % 4], size: rand(1.5, 3.2) });
    }
  }
  function sparks(x, y, n, spd) {
    for (let i = 0; i < n && state.particles.length < 1000; i++) {
      const a = Math.random() * TAU, v = rand(1.5, spd || 4);
      state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(8, 16), max: 16, size: 1, spark: true });
    }
  }
  function smoke(x, y, n, size) {
    for (let i = 0; i < n && state.particles.length < 1000; i++) {
      state.particles.push({ x: x + rand(-6, 6), y: y + rand(-6, 6), vx: rand(-0.4, 0.4), vy: rand(-0.6, -0.1), life: rand(40, 70), max: 70, size: (size || 5) * rand(0.7, 1.2), grow: 0.12, smoke: true });
    }
  }
  function shake(n) { state.shake = Math.max(state.shake, n); }
  function floatText(x, y, text, color) {
    if (state.floats.length > 40) return;
    state.floats.push({ x, y, text, color, life: 40 });
  }

  // ------------------------------------------------------------------ enemies
  function hpMul(boss) {
    const n = state.wave + 1;
    const late = n > FINAL_WAVE ? 1 + (n - FINAL_WAVE) * 0.1 : 1;
    if (boss) return late;
    return (n <= 8 ? 1 : 1 + (n - 8) * 0.05) * late;
  }
  function spawnUnit(key, d) {
    const u = UNITS[key];
    const path = u.fly ? AIR : GROUND;
    const hp = Math.round(u.hp * hpMul(u.boss));
    const p = posAt(path, d);
    const e = {
      id: nextId++, u, path, d, hp, maxHp: hp, x: p.x, y: p.y, facing: p.ang, alive: true,
      phase: Math.random() * TAU, flash: 0, slowT: 0, slowMul: 1, spawnCd: u.spawnEvery || 0,
      synapsed: false, nulled: 0,
    };
    state.enemies.push(e);
    return e;
  }
  function speedOf(e) {
    const n = state.wave + 1;
    const late = n > FINAL_WAVE ? 1 + (n - FINAL_WAVE) * 0.02 : 1;
    return e.u.speed * late * (e.synapsed ? 1.25 : 1) * (e.slowT > 0 ? e.slowMul : 1);
  }
  function predict(e, ticks) {
    return posAt(e.path, e.d + speedOf(e) * ticks);
  }

  function damage(e, dmg, ap, src, o) {
    if (!e.alive) return true;
    o = o || {};
    const armour = Math.max(0, e.u.armour - e.nulled);
    // Armour soaks damage but never all of it: low-AP weapons still chip for 20%.
    let dealt = dmg - Math.max(0, armour - ap);
    if (dealt < dmg * 0.2) {
      dealt = dmg * 0.2;
      sfx.clang();
      if (Math.random() < 0.3) sparks(e.x, e.y, 3, 3);
      if (Math.random() < 0.15) floatText(e.x, e.y - 14, 'ARMOUR', '#c9c0a8');
    }
    if (e.u.ward && !o.psychic) dealt *= 0.5;
    if (o.airMul && e.u.fly) dealt *= o.airMul;
    e.hp -= dealt;
    e.flash = 4;
    if (o.stun) {
      e.slowT = Math.max(e.slowT, e.u.boss ? o.stun / 3 : o.stun);
      e.slowMul = e.u.boss ? 0.5 : 0;
    } else if (o.slow && (e.slowT <= 0 || e.slowMul > o.slow.mul)) {
      e.slowT = o.slow.t; e.slowMul = o.slow.mul;
    }
    if (e.hp > 0) {
      if (Math.random() < 0.35) burst(e.x, e.y, null, 2, 1.5);
      return true;
    }
    kill(e, src);
    return true;
  }
  function kill(e, src) {
    e.alive = false;
    state.money += Math.ceil(e.u.bounty * 2);
    if (src) src.kills += 1;
    burst(e.x, e.y, null, e.u.boss ? 70 : 6 + e.u.r * 0.6, e.u.boss ? 5 : 2.4);
    sfx.squelch();
    if (state.decals.length > 140) state.decals.shift();
    state.decals.push({ x: e.x, y: e.y, r: e.u.r * rand(0.9, 1.4), rot: Math.random() * TAU, color: ICHOR[(Math.random() * 4) | 0], v: (Math.random() * 6) | 0, life: 900 });
    if (e.u.r >= 16) { shake(e.u.boss ? 9 : 3); smoke(e.x, e.y, e.u.boss ? 14 : 4, e.u.boss ? 10 : 6); }
    if (e.u.boss) { sfx.boom(); floatText(e.x, e.y, `${e.u.name.toUpperCase()} SLAIN`, '#f0c96a'); }
  }

  // ------------------------------------------------------------------- towers
  function buildStats(t) {
    const def = TOWERS[t.type];
    const s = JSON.parse(JSON.stringify(def.base));
    s.camo = !!s.camo;
    if (t.trunk) def.trunk.apply(s);
    if (t.path >= 0) for (let i = 0; i < t.lv; i++) def.paths[t.path].nodes[i].apply(s);
    for (const w of s.w) { w.pierce = w.pierce || 1; w.count = w.count || 1; w.spread = w.spread || 0; }
    t.stats = s;
    t.cds = s.w.map((_, i) => (t.cds && t.cds[i] !== undefined ? t.cds[i] : 10));
  }
  function placeTower(type, x, y) {
    const def = TOWERS[type];
    const t = { id: nextId++, type, x, y, trunk: 0, path: -1, lv: 0, spent: def.cost, angle: -Math.PI / 2, kills: 0, mode: 'first', buff: null, flash: 0, punch: 0, leap: null, shot: 0 };
    buildStats(t);
    state.towers.push(t);
    state.money -= def.cost;
    sfx.place();
    burst(x, y, '#c9a24a', 10, 2);
    return t;
  }
  function canPlace(type, x, y) {
    const r = TOWERS[type].r;
    if (x < r || y < r || x > W - r || y > H - r) return false;
    if (x > 868) return false; // the fortress wall
    for (const o of TERRAIN.obstacles) if (Math.hypot(o.x - x, o.y - y) < o.r + r * 0.7) return false;
    if (distToGround(x, y) < PATH_W / 2 + r - 4) return false;
    for (const t of state.towers) if (Math.hypot(t.x - x, t.y - y) < r + TOWERS[t.type].r) return false;
    return true;
  }

  // Skill tree: the trunk upgrade first, then the nodes of one doctrine in order.
  function nodeFor(t, which) {
    const def = TOWERS[t.type];
    if (which === 'trunk') return t.trunk ? null : def.trunk;
    if (!t.trunk || (t.path >= 0 && t.path !== which)) return null;
    return def.paths[which].nodes[t.path === which ? t.lv : 0] || null;
  }
  function buy(t, which) {
    const node = nodeFor(t, which);
    if (!node) return false;
    if (state.money < node.cost) { toast('Not enough requisition.'); return false; }
    state.money -= node.cost;
    t.spent += node.cost;
    if (which === 'trunk') t.trunk = 1;
    else { t.path = which; t.lv += 1; }
    buildStats(t);
    sfx.place();
    burst(t.x, t.y, '#c9a24a', 14, 2.5);
    return true;
  }

  function effW(t, w) {
    const b = t.buff || { rateMul: 1, dmg: 0, ap: 0, rangeMul: 1 };
    return { range: w.range * b.rangeMul, rate: w.rate * b.rateMul, dmg: w.dmg + b.dmg, ap: w.ap + b.ap };
  }
  function seesCamo(t) { return t.stats.camo || (t.buff && t.buff.camo); }
  function eligible(e, w, camo) {
    return e.alive && e.x > 0 && (!e.u.fly || w.air) && (!e.u.camo || camo);
  }

  function computeAuras() {
    const chaplains = state.towers.filter((t) => t.stats.aura);
    for (const t of state.towers) {
      const b = { rateMul: 1, dmg: 0, ap: 0, camo: false, rangeMul: 1 };
      for (const c of chaplains) {
        if (c === t || Math.hypot(c.x - t.x, c.y - t.y) > c.stats.aura.radius) continue;
        const a = c.stats.aura;
        b.rateMul = Math.min(b.rateMul, a.rate);
        b.dmg = Math.max(b.dmg, a.dmg);
        b.ap = Math.max(b.ap, a.ap);
        b.camo = b.camo || a.camo;
        b.rangeMul = Math.max(b.rangeMul, a.rangeMul);
      }
      t.buff = b;
    }
    const nullers = state.towers.filter((t) => t.stats.nullZone);
    for (const e of state.enemies) {
      e.nulled = 0; e.synapsed = false;
      for (const n of nullers) if (Math.hypot(e.x - n.x, e.y - n.y) <= effW(n, n.stats.w[0]).range) e.nulled = Math.max(e.nulled, n.stats.nullZone);
    }
    const syn = state.enemies.filter((e) => e.alive && e.u.synapse && !e.nulled);
    if (!syn.length) return;
    for (const e of state.enemies) {
      if (e.u.synapse) continue;
      for (const s of syn) {
        const dx = s.x - e.x, dy = s.y - e.y;
        if (dx * dx + dy * dy < 8100) { e.synapsed = true; break; }
      }
    }
  }

  function findTarget(t, w, ef) {
    const camo = seesCamo(t);
    let best = null, bestScore = -Infinity;
    for (const e of state.enemies) {
      if (!eligible(e, w, camo)) continue;
      const dist = Math.hypot(e.x - t.x, e.y - t.y);
      if (dist > ef.range + e.u.r * 0.5) continue;
      let score;
      switch (t.mode) {
        case 'last': score = -e.d / e.path.len; break;
        case 'strong': score = e.u.threat * 1000 + e.hp + (e.u.boss ? 1e7 : 0); break;
        case 'close': score = -dist; break;
        default: score = e.d / e.path.len;
      }
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  function modelPos(t, i) {
    const f = TOWERS[t.type].formation;
    if (!f) return { x: t.x, y: t.y };
    const [dx, dy] = f[i % f.length];
    return { x: t.x + dx * MODEL_SCALE, y: t.y + dy * MODEL_SCALE };
  }

  // layer: 'ground', 'air' or 'both'
  function areaHit(x, y, radius, hits, dmg, ap, src, o, layer) {
    const list = state.enemies
      .filter((e) => e.alive && e.x > -10 && (layer === 'both' || (layer === 'air') === !!e.u.fly))
      .map((e) => ({ e, dist: Math.hypot(e.x - x, e.y - y) }))
      .filter(({ e, dist }) => dist <= radius + e.u.r * 0.7)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, hits);
    for (const { e } of list) damage(e, dmg, ap, src, o);
  }

  function fire(t, w, target, ef) {
    const opts = { psychic: w.psychic, airMul: w.airMul, stun: w.stun, slow: w.slow };
    t.flash = 6;
    switch (w.kind) {
      case 'proj': {
        const m = modelPos(t, t.shot++);
        let p = predict(target, Math.hypot(target.x - m.x, target.y - m.y) / w.speed);
        p = predict(target, Math.hypot(p.x - m.x, p.y - m.y) / w.speed);
        const base = Math.atan2(p.y - m.y, p.x - m.x);
        if (w === t.stats.w[0]) t.angle = base;
        for (let i = 0; i < w.count; i++) {
          const off = w.count > 1 ? (i - (w.count - 1) / 2) * w.spread : rand(-w.spread, w.spread);
          const a = base + off;
          state.projectiles.push({
            x: m.x + Math.cos(a) * 12, y: m.y + Math.sin(a) * 12, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
            dmg: ef.dmg, ap: ef.ap, pierce: w.pierce, splash: w.splash || 0, style: w.style, air: w.air,
            homing: w.homing, target, src: t, o: opts, life: (ef.range * 1.6) / w.speed, hit: new Set(),
          });
        }
        if (w.style === 'plasma') sfx.plasma(); else if (w.style === 'missile') sfx.missile(); else sfx.bolt();
        break;
      }
      case 'snipe': {
        const m = modelPos(t, t.shot++);
        t.angle = Math.atan2(target.y - m.y, target.x - m.x);
        state.fx.push({ type: 'tracer', x1: m.x, y1: m.y, x2: target.x, y2: target.y, life: 8, max: 8 });
        damage(target, ef.dmg, ef.ap, t, opts);
        sfx.snipe();
        break;
      }
      case 'flame': {
        const a = Math.atan2(target.y - t.y, target.x - t.x);
        if (w === t.stats.w[0]) t.angle = a;
        const hits = state.enemies
          .filter((e) => e.alive && !e.u.fly && e.x > 0)
          .map((e) => ({ e, dist: Math.hypot(e.x - t.x, e.y - t.y) }))
          .filter(({ e, dist }) => dist <= ef.range + e.u.r && Math.abs(angleDiff(Math.atan2(e.y - t.y, e.x - t.x), a)) <= w.cone)
          .sort((p, q) => p.dist - q.dist)
          .slice(0, w.hits);
        for (const { e } of hits) damage(e, ef.dmg, ef.ap, t, opts);
        for (let i = 0; i < 14; i++) {
          const aa = a + rand(-w.cone, w.cone) * 0.8, v = rand(2.5, 4.5);
          state.particles.push({ x: t.x + Math.cos(a) * 12, y: t.y + Math.sin(a) * 12, vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, life: ef.range / v, max: ef.range / v, color: Math.random() < 0.5 ? '#ffb030' : '#ff5a1a', size: rand(3, 6), flame: true });
        }
        sfx.flame();
        break;
      }
      case 'shell': {
        t.angle = Math.atan2(target.y - t.y, target.x - t.x);
        const p = predict(target, w.flight);
        for (let i = 0; i < w.count; i++) {
          const sx = i ? rand(-28, 28) : 0, sy = i ? rand(-28, 28) : 0;
          state.shells.push({ sx: t.x, sy: t.y, tx: p.x + sx, ty: p.y + sy, t: -i * 8, dur: w.flight, src: t, w, dmg: ef.dmg, ap: ef.ap });
        }
        sfx.missile();
        break;
      }
      case 'chain': {
        const camo = seesCamo(t);
        const hitSet = new Set();
        t.angle = Math.atan2(target.y - t.y, target.x - t.x);
        const pts = [[t.x + Math.cos(t.angle) * 16, t.y + Math.sin(t.angle) * 16]];
        let cur = target;
        for (let i = 0; i < w.chain && cur; i++) {
          hitSet.add(cur.id);
          pts.push([cur.x, cur.y]);
          const from = cur;
          damage(cur, ef.dmg, ef.ap, t, opts);
          let next = null, nd = 95;
          for (const e of state.enemies) {
            if (hitSet.has(e.id) || !eligible(e, w, camo)) continue;
            const dd = Math.hypot(e.x - from.x, e.y - from.y);
            if (dd < nd) { nd = dd; next = e; }
          }
          cur = next;
        }
        state.fx.push({ type: 'arc', pts, life: 12, max: 12 });
        sfx.arc();
        break;
      }
      case 'blast': {
        state.fx.push({ type: 'vortex', x: target.x, y: target.y, r: w.splash, life: 40, max: 40 });
        areaHit(target.x, target.y, w.splash, 30, ef.dmg, ef.ap, t, opts, 'both');
        shake(3);
        sfx.boom();
        break;
      }
      case 'smash': {
        t.angle = Math.atan2(target.y - t.y, target.x - t.x);
        t.punch = 10;
        if (w.splash) areaHit(target.x, target.y, w.splash, w.hits, ef.dmg, ef.ap, t, opts, w.air ? 'both' : 'ground');
        else damage(target, ef.dmg, ef.ap, t, opts);
        state.fx.push({ type: 'ring', x: target.x, y: target.y, r: Math.max(16, w.splash), life: 14, max: 14 });
        if (w.splash) { smoke(target.x, target.y, 2, 5); shake(1); }
        sfx.smash();
        break;
      }
      case 'leap': {
        const p = predict(target, 16);
        t.angle = Math.atan2(p.y - t.y, p.x - t.x);
        t.leap = { t: 0, out: 16, hold: 12, back: 14, tx: p.x, ty: p.y, w, ef, opts };
        noise(0.3, 0.05, 700);
        break;
      }
    }
  }

  function updateLeap(t) {
    const L = t.leap;
    L.t++;
    if (L.t === L.out) {
      areaHit(L.tx, L.ty, L.w.splash, L.w.hits, L.ef.dmg, L.ef.ap, t, L.opts, 'both');
      state.fx.push({ type: 'ring', x: L.tx, y: L.ty, r: L.w.splash, life: 16, max: 16 });
      burst(L.tx, L.ty, '#8a7a62', 8, 2.5);
      smoke(L.tx, L.ty, 3, 6);
      shake(1.5);
      sfx.smash();
    }
    if (L.t >= L.out + L.hold + L.back) t.leap = null;
  }
  function leapOffset(t) {
    const L = t.leap;
    const tx = L.tx - t.x, ty = L.ty - t.y;
    if (L.t < L.out) { const k = L.t / L.out; return { dx: tx * k, dy: ty * k, h: Math.sin(k * Math.PI) }; }
    if (L.t < L.out + L.hold) return { dx: tx, dy: ty, h: 0 };
    const k = (L.t - L.out - L.hold) / L.back;
    return { dx: tx * (1 - k), dy: ty * (1 - k), h: Math.sin(k * Math.PI) };
  }

  function explodeShell(sh) {
    const w = sh.w;
    state.fx.push({ type: 'boom', x: sh.tx, y: sh.ty, r: w.splash, life: 18, max: 18 });
    burst(sh.tx, sh.ty, '#5a4a3a', 10, 3.5);
    sparks(sh.tx, sh.ty, 10, 5);
    smoke(sh.tx, sh.ty, 5, 7);
    shake(2.5);
    if (state.decals.length > 140) state.decals.shift();
    state.decals.push({ x: sh.tx, y: sh.ty, r: w.splash * 0.7, scorch: true, life: 600 });
    sfx.boom();
    areaHit(sh.tx, sh.ty, w.splash, w.hits, sh.dmg, sh.ap, sh.src, {}, 'ground');
    if (w.burn) state.zones.push({ x: sh.tx, y: sh.ty, r: w.splash * 0.8, life: w.burn.life, max: w.burn.life, every: w.burn.every, dmg: w.burn.dmg, src: sh.src });
  }

  // --------------------------------------------------------------- game flow
  function startWave() {
    if (state.waveActive || state.over || (state.won && !state.freeplay)) return;
    ensureAudio();
    const n = state.wave + 1;
    state.queue = buildSchedule(n);
    state.waveTick = 0;
    state.waveActive = true;
    sfx.horn();
    const fresh = [...new Set(state.queue.map((q) => q.key))].filter((k) => !state.seen.has(k));
    fresh.forEach((k) => state.seen.add(k));
    const intro = fresh.map((k) => INTROS[k]).filter(Boolean);
    if (intro.length) toast(intro.join(' '), 4500 + intro.length * 1500);
    updateHud(true);
    renderPanel();
  }

  function endWave() {
    state.waveActive = false;
    state.wave += 1;
    const bonus = 100 + state.wave * 4;
    state.money += bonus;
    floatText(W / 2, 40, `Wave ${state.wave} repelled  +${bonus}`, '#c9a24a');
    try {
      const best = Number(localStorage.getItem('bloomfall-best') || 0);
      if (state.wave > best) localStorage.setItem('bloomfall-best', String(state.wave));
    } catch (e) { /* storage unavailable */ }
    if (state.wave === FINAL_WAVE && !state.freeplay) {
      state.won = true;
      showOverlay('The Hive Holds', `The hive fleet is broken after ${FINAL_WAVE} waves, with ${state.lives} Faith remaining. The Emperor protects.`, [
        ['Keep fighting (freeplay)', () => { state.freeplay = true; hideOverlay(); updateHud(true); }],
        ['New campaign', restart],
      ]);
    }
    state.autoTimer = 90;
    updateHud(true);
    renderPanel();
  }

  function tick() {
    if (state.over) return;
    state.time++;

    if (state.waveActive) {
      state.waveTick++;
      while (state.queue.length && state.queue[0].at <= state.waveTick) spawnUnit(state.queue.shift().key, 0);
    } else if (state.auto && (!state.won || state.freeplay)) {
      if (--state.autoTimer <= 0) startWave();
    }

    computeAuras();

    // move the swarm
    const count = state.enemies.length;
    for (let i = 0; i < count; i++) {
      const e = state.enemies[i];
      if (!e.alive) continue;
      if (e.flash > 0) e.flash--;
      if (e.slowT > 0) e.slowT--;
      e.d += speedOf(e);
      const p = posAt(e.path, e.d);
      if (e.u.fly) {
        const wob = Math.sin(state.time * 0.04 + e.phase) * 10;
        p.x += -Math.sin(p.ang) * wob; p.y += Math.cos(p.ang) * wob;
      }
      e.facing += angleDiff(p.ang, e.facing) * 0.15;
      e.x = p.x; e.y = p.y;
      if (e.u.spawns && --e.spawnCd <= 0) {
        e.spawnCd = e.u.spawnEvery;
        spawnUnit(e.u.spawns, Math.max(0, e.d - e.u.r));
      }
      if (e.d >= e.path.end) {
        e.alive = false;
        state.lives -= e.u.leak;
        sparks(e.x, e.y, 8, 4);
        shake(e.u.leak >= 10 ? 5 : 1.5);
        sfx.leak();
        floatText(e.x - 20, e.y - 16, `-${e.u.leak}`, '#ff6b5b');
      }
    }

    // marines
    for (const t of state.towers) {
      if (t.flash > 0) t.flash--;
      if (t.punch > 0) t.punch--;
      if (t.leap) updateLeap(t);
      t.stats.w.forEach((w, i) => {
        if (t.cds[i] > 0) { t.cds[i]--; return; }
        if (w.kind === 'leap' && t.leap) return;
        const ef = effW(t, w);
        const target = findTarget(t, w, ef);
        if (!target) return;
        fire(t, w, target, ef);
        t.cds[i] = ef.rate;
      });
    }

    // projectiles
    for (const p of state.projectiles) {
      if (p.homing && p.target.alive) {
        const want = Math.atan2(p.target.y - p.y, p.target.x - p.x);
        const cur = Math.atan2(p.vy, p.vx);
        const a = cur + clamp(angleDiff(want, cur), -0.12, 0.12);
        const sp = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      }
      p.x += p.vx; p.y += p.vy; p.life--;
      if (p.style === 'missile' && state.time % 2 === 0) state.particles.push({ x: p.x, y: p.y, vx: rand(-0.2, 0.2), vy: rand(-0.2, 0.2), life: 26, max: 26, size: 2.5, grow: 0.12, smoke: true });
      if (p.life <= 0 || p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) { p.dead = true; continue; }
      for (let i = 0, m = state.enemies.length; i < m; i++) {
        const e = state.enemies[i];
        if (!e.alive || p.hit.has(e.id) || e.x < 0 || (e.u.fly && !p.air)) continue;
        const r = e.u.r * 0.8 + 3;
        if (Math.abs(e.x - p.x) > r || Math.abs(e.y - p.y) > r) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) > r) continue;
        p.hit.add(e.id);
        let ok;
        if (p.splash) {
          damage(e, p.dmg, p.ap, p.src, p.o);
          areaHit(p.x, p.y, p.splash, 8, p.dmg * 0.6, p.ap, p.src, p.o, e.u.fly ? 'air' : 'ground');
          state.fx.push({ type: 'boom', x: p.x, y: p.y, r: p.splash, life: 12, max: 12, color: p.style === 'plasma' ? 'plasma' : '' });
          if (p.style === 'missile') { smoke(p.x, p.y, 2, 5); sparks(p.x, p.y, 4, 4); }
          ok = false;
        } else {
          ok = damage(e, p.dmg, p.ap, p.src, p.o);
        }
        if (p.style === 'plasma') burst(p.x, p.y, '#8fe0ff', 4, 2);
        p.pierce = ok ? p.pierce - 1 : 0;
        if (p.pierce <= 0) { p.dead = true; break; }
      }
    }
    state.projectiles = state.projectiles.filter((p) => !p.dead);

    for (const sh of state.shells) if (++sh.t >= sh.dur) { sh.dead = true; explodeShell(sh); }
    state.shells = state.shells.filter((s) => !s.dead);

    for (const z of state.zones) {
      z.life--;
      if (z.life % z.every === 0) {
        for (const e of state.enemies) if (e.alive && !e.u.fly && Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.u.r * 0.5) damage(e, z.dmg, 9, z.src, {});
      }
    }
    state.zones = state.zones.filter((z) => z.life > 0);

    state.enemies = state.enemies.filter((e) => e.alive);

    for (const p of state.particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--; if (p.grow) p.size += p.grow; }
    state.particles = state.particles.filter((p) => p.life > 0);
    if (state.particles.length > 1000) state.particles.splice(0, state.particles.length - 1000);
    for (const f of state.fx) f.life--;
    state.fx = state.fx.filter((f) => f.life > 0);
    for (const f of state.floats) { f.life--; f.y -= 0.5; }
    state.floats = state.floats.filter((f) => f.life > 0);
    for (const d of state.decals) d.life--;
    state.decals = state.decals.filter((d) => d.life > 0);

    if (state.lives <= 0) {
      state.lives = 0;
      state.over = true;
      showOverlay('The Hive Falls', `The swarm breached the gate on wave ${state.wave + 1}. ${bestText()}`, [['Begin again', restart]]);
    } else if (state.waveActive && !state.queue.length && !state.enemies.length) {
      endWave();
    }
  }

  function bestText() {
    try {
      const best = Number(localStorage.getItem('bloomfall-best') || 0);
      return best ? `Best: wave ${best}.` : '';
    } catch (e) { return ''; }
  }

  // =============================================================== rendering
  // Everything from here to the UI section only draws. Sprites are baked once
  // (supersampled, dome-shaded, outlined, with a soft silhouette shadow) and stamped
  // each frame. A half-resolution light map is multiplied over the scene, then bright
  // sources get an additive glow pass, then fog, ash and a vignette.

  const SS = 2;
  let lowQuality = false; // flipped on automatically if the frame rate sags
  const AMBIENT = 'rgb(182,172,190)';
  const SHADOW = { dx: 3, dy: 4 };

  function makeCanvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w)); cv.height = Math.max(1, Math.ceil(h));
    return cv;
  }
  const canFilter = (() => { try { return typeof makeCanvas(1, 1).getContext('2d').filter === 'string'; } catch (e) { return false; } })();

  function bake(half, draw, o) {
    o = o || {};
    const ss = o.ss || SS;
    const size = Math.ceil(half * 2 * ss);
    const art = makeCanvas(size, size);
    const a = art.getContext('2d');
    a.translate(size / 2, size / 2); a.scale(ss, ss);
    draw(a);
    a.setTransform(1, 0, 0, 1, 0, 0);
    if (o.shade !== false) {
      const R = (o.shadeR || half * 0.8) * ss;
      const g = a.createRadialGradient(size / 2, size / 2, R * 0.05, size / 2, size / 2, R);
      g.addColorStop(0, 'rgba(255,248,230,0.16)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
      a.globalCompositeOperation = 'source-atop';
      a.fillStyle = g; a.fillRect(0, 0, size, size);
      a.globalCompositeOperation = 'source-over';
    }
    let cv = art;
    if (o.outline !== 0) {
      cv = makeCanvas(size, size);
      const c = cv.getContext('2d');
      const k = (o.outline || 1) * ss;
      for (let i = 0; i < 8; i++) c.drawImage(art, Math.cos((i / 8) * TAU) * k, Math.sin((i / 8) * TAU) * k);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = o.outlineColor || '#0c090b'; c.fillRect(0, 0, size, size);
      c.globalCompositeOperation = 'source-over';
      c.drawImage(art, 0, 0);
    }
    let shadow = null;
    if (o.shadow !== false) {
      shadow = makeCanvas(size, size);
      const s = shadow.getContext('2d');
      if (canFilter) s.filter = `blur(${1.5 * ss}px)`;
      s.drawImage(cv, 0, 0);
      if (canFilter) s.filter = 'none';
      s.globalCompositeOperation = 'source-in';
      s.fillStyle = '#000'; s.fillRect(0, 0, size, size);
    }
    return { cv, shadow, half };
  }
  const spriteCache = new Map();
  function cached(key, half, draw, o) {
    let s = spriteCache.get(key);
    if (!s) { s = bake(half, draw, o); spriteCache.set(key, s); }
    return s;
  }
  function stamp(c, spr, x, y, ang, scale, shadowAlpha, shadowOff) {
    const s = spr.half * 2 * (scale || 1);
    if (shadowAlpha && spr.shadow) {
      const o = shadowOff || SHADOW;
      const a = c.globalAlpha;
      c.globalAlpha = a * shadowAlpha;
      c.save(); c.translate(x + o.dx, y + o.dy); c.rotate(ang || 0); c.drawImage(spr.shadow, -s / 2, -s / 2, s, s); c.restore();
      c.globalAlpha = a;
    }
    c.save(); c.translate(x, y); c.rotate(ang || 0); c.drawImage(spr.cv, -s / 2, -s / 2, s, s); c.restore();
  }

  // Additive glow sprites, keyed by 'r,g,b'.
  const glowCache = new Map();
  function glowSprite(rgb) {
    let cv = glowCache.get(rgb);
    if (!cv) {
      cv = makeCanvas(64, 64);
      const c = cv.getContext('2d');
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.25, `rgba(${rgb},0.45)`); g.addColorStop(0.6, `rgba(${rgb},0.12)`); g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
      glowCache.set(rgb, cv);
    }
    return cv;
  }
  function glow(c, x, y, r, rgb, a) {
    if (a <= 0) return;
    c.globalAlpha = Math.min(1, a);
    c.drawImage(glowSprite(rgb), x - r, y - r, r * 2, r * 2);
  }

  const LM = 2; // the light map is half resolution
  const lightCv = makeCanvas(W / LM, H / LM);
  const lctx = lightCv.getContext('2d');
  const lights = [];
  function light(x, y, r, rgb, a) { lights.push({ x, y, r, rgb, a }); }
  function applyLights(c) {
    lctx.globalCompositeOperation = 'source-over'; lctx.globalAlpha = 1;
    lctx.fillStyle = AMBIENT; lctx.fillRect(0, 0, W / LM, H / LM);
    lctx.globalCompositeOperation = 'lighter';
    for (const L of lights) glow(lctx, L.x / LM, L.y / LM, L.r / LM, L.rgb, L.a);
    lctx.globalAlpha = 1;
    c.globalCompositeOperation = 'multiply';
    c.drawImage(lightCv, 0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    lights.length = 0;
  }

  // ------------------------------------------------------------------ noise
  function makeNoise(seed, period) {
    const rng = mulberry32(seed);
    const P = period, g = new Float32Array(P * P);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    const sm = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = sm(x - xi), yf = sm(y - yi);
      const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
      const a = g[y0 * P + x0], b = g[y0 * P + x1], c = g[y1 * P + x0], d = g[y1 * P + x1];
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
  }
  function fbm(n, x, y, oct) {
    let v = 0, amp = 0.5, f = 1, tot = 0;
    for (let i = 0; i < oct; i++) { v += n(x * f, y * f) * amp; tot += amp; amp *= 0.5; f *= 2; }
    return v / tot;
  }

  // --------------------------------------------------------------- materials
  function domeFill(c, x, y, r, col) {
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r * 1.1);
    g.addColorStop(0, shade(col, 75)); g.addColorStop(0.45, col); g.addColorStop(1, shade(col, -60));
    return g;
  }
  function linFill(c, x0, y0, x1, y1, col, hi, lo) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, shade(col, hi === undefined ? 45 : hi)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, lo === undefined ? -45 : lo));
    return g;
  }
  function goldFill(c, x0, y0, x1, y1) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#fff3c0'); g.addColorStop(0.35, '#e0b84a'); g.addColorStop(0.7, '#a07818'); g.addColorStop(1, '#5a420c');
    return g;
  }
  function steel(c, x, y, w, h, col) {
    c.fillStyle = linFill(c, 0, y, 0, y + h, col || '#3a3b40', 55, -35);
    rr(c, x, y, w, h, Math.min(1.2, h / 3)); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(x + 0.5, y + 0.4, w - 1, 0.5);
  }
  function shaded(c, x, y, rx, ry, col) {
    if (col[0] !== '#') { blob(c, x, y, rx, ry, col); return; }
    const g = c.createRadialGradient(x - rx * 0.3, y - ry * 0.45, Math.min(rx, ry) * 0.1, x, y, Math.max(rx, ry) * 1.1);
    g.addColorStop(0, shade(col, 55)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -55));
    c.fillStyle = g;
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill();
  }
  function spec(c, x, y, rx, ry, a) { blob(c, x, y, rx, ry, `rgba(255,255,255,${a || 0.35})`); }

  // ---------------------------------------------------------------- terrain
  // The layout is fixed; decor that stands up off the ground blocks deployment.
  const TERRAIN = { obstacles: [], fires: [] };
  const DECOR = {
    spires: [[42, 205, 50], [134, 28, 40], [24, 566, 56], [292, 40, 30]],
    pillars: [[586, 46, 30], [622, 74, 18], [150, 585, 14]],
    traps: [[232, 560], [268, 576], [304, 558], [340, 574]],
    wreck: [700, 548],
    walls: [[420, 36, 128, 30], [612, 552, 64, 22]],
  };
  DECOR.spires.forEach(([x, y]) => TERRAIN.obstacles.push({ x, y, r: 14 }));
  DECOR.pillars.forEach(([x, y, h]) => TERRAIN.obstacles.push({ x, y, r: h > 20 ? 12 : 9 }));
  DECOR.traps.forEach(([x, y]) => TERRAIN.obstacles.push({ x, y, r: 9 }));
  TERRAIN.obstacles.push({ x: DECOR.wreck[0], y: DECOR.wreck[1], r: 28 });
  DECOR.walls.forEach(([x, y, len]) => { for (let k = 6; k < len; k += 14) TERRAIN.obstacles.push({ x: x + k, y: y + 5, r: 10 }); });
  TERRAIN.fires.push({ x: DECOR.wreck[0] + 6, y: DECOR.wreck[1] - 12, s: 1.2 }, { x: DECOR.wreck[0] - 12, y: DECOR.wreck[1] - 6, s: 0.8 });
  TERRAIN.fires.push({ x: 902, y: 36, s: 0.7, brazier: true }, { x: 902, y: 186, s: 0.7, brazier: true }, { x: 924, y: 300, s: 0.8, brazier: true }, { x: 924, y: 500, s: 0.8, brazier: true });

  function box(c, x, y, w, d, h, top, side) {
    const k = h * 0.6;
    c.fillStyle = 'rgba(0,0,0,0.32)'; c.fillRect(x + k * 0.6, y + k * 0.15, w, d);
    c.fillStyle = side; c.fillRect(x, y + d - k, w, k);
    c.fillStyle = top; c.fillRect(x, y - k, w, d);
    c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(x, y - k, w, 1);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x, y + d - k, w, 1);
  }

  function paintGround(c) {
    const gw = W / 2, gh = H / 2;
    const cv = makeCanvas(gw, gh), g = cv.getContext('2d');
    const img = g.createImageData(gw, gh);
    const n1 = makeNoise(11, 64), n2 = makeNoise(23, 64), n3 = makeNoise(37, 64);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const u = x / 38, v = y / 38;
      const base = fbm(n1, u, v, 5);
      const dust = fbm(n2, u * 0.6 + 7, v * 0.6, 4);
      const rust = fbm(n3, u * 1.4, v * 1.4, 3);
      let r = 34 + base * 58, gg = 30 + base * 48, b = 27 + base * 40;
      if (dust > 0.55) { const k = Math.min(1, (dust - 0.55) * 4); r += 24 * k; gg += 23 * k; b += 25 * k; }
      if (rust > 0.6) { const k = Math.min(1, (rust - 0.6) * 4); r += 22 * k; gg += 5 * k; b -= 6 * k; }
      const i = (y * gw + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(cv, 0, 0, W, H);
    const rng = mulberry32(9001);
    for (let i = 0; i < 7000; i++) {
      c.fillStyle = rng() < 0.55 ? `rgba(0,0,0,${0.08 + rng() * 0.15})` : `rgba(255,236,200,${0.03 + rng() * 0.06})`;
      c.fillRect(rng() * W, rng() * H, 0.6 + rng() * 1.4, 0.6 + rng() * 1.4);
    }
    // pebbles and shards
    for (let i = 0; i < 420; i++) {
      const x = rng() * W, y = rng() * H, r = 0.8 + rng() * 2.4;
      blob(c, x + 0.8, y + 1, r, r * 0.7, 'rgba(0,0,0,0.35)');
      const tone = 70 + rng() * 50 | 0;
      blob(c, x, y, r, r * 0.7, `rgb(${tone},${tone - 6},${tone - 12})`);
      blob(c, x - r * 0.3, y - r * 0.3, r * 0.4, r * 0.25, 'rgba(255,255,255,0.18)');
    }
    // ground cracks
    c.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      let x = rng() * W, y = rng() * H, a = rng() * TAU;
      c.strokeStyle = 'rgba(10,8,6,0.5)'; c.lineWidth = 0.8 + rng() * 1.2;
      c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 6; k++) { a += rand(-0.7, 0.7); x += Math.cos(a) * 9; y += Math.sin(a) * 9; c.lineTo(x, y); }
      c.stroke();
    }
    // craters
    for (let i = 0; i < 30; i++) {
      const x = rng() * W, y = rng() * H, r = 8 + rng() * 22;
      if (distToGround(x, y) < r + PATH_W / 2 + 6 || x > 860) continue;
      crater(c, x, y, r);
    }
  }
  function crater(c, x, y, r) {
    const g = c.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.2, x, y, r * 1.35);
    g.addColorStop(0, 'rgba(118,104,88,0)'); g.addColorStop(0.7, 'rgba(118,104,88,0)'); g.addColorStop(0.82, 'rgba(140,124,104,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(x, y, r * 1.35, r * 1.1, 0, 0, TAU); c.fill();
    const b = c.createRadialGradient(x + r * 0.25, y + r * 0.25, r * 0.1, x, y, r);
    b.addColorStop(0, '#120e0b'); b.addColorStop(0.7, '#2a231d'); b.addColorStop(1, 'rgba(60,50,40,0.6)');
    c.fillStyle = b; c.beginPath(); c.ellipse(x, y, r, r * 0.8, 0, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(190,170,140,0.25)'; c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(x, y, r, r * 0.8, 0, Math.PI * 0.95, Math.PI * 1.75); c.stroke();
  }

  function paintCreep(c) {
    const gw = W / 2, gh = H / 2;
    const cv = makeCanvas(gw, gh), g = cv.getContext('2d');
    const img = g.createImageData(gw, gh);
    const n = makeNoise(51, 64), nv = makeNoise(77, 64);
    const src = [[0, 90, 230], [0, 340, 110], [24, 566, 90], [134, 28, 80], [42, 205, 70]];
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const lx = x * 2, ly = y * 2;
      let infl = -Infinity;
      for (const [sx, sy, r] of src) infl = Math.max(infl, 1 - Math.hypot(lx - sx, (ly - sy) * 1.1) / r);
      if (infl < -0.2) continue;
      const f = fbm(n, x / 26, y / 26, 4);
      const v = infl * 1.2 + (f - 0.5) * 0.6;
      if (v <= 0.05) continue;
      const edge = clamp((v - 0.05) / 0.14, 0, 1);
      const vein = Math.abs(fbm(nv, x / 14, y / 14, 3) - 0.5);
      const vk = vein < 0.035 ? 1 - vein / 0.035 : 0;
      let r = 70 + f * 70, gg = 18 + f * 26, b = 60 + f * 60;
      r = r * (1 - vk * 0.6) + 25 * vk * 0.6; gg *= 1 - vk * 0.6; b = b * (1 - vk * 0.6) + 30 * vk * 0.6;
      if (f > 0.66) { const k = (f - 0.66) * 3; r += 80 * k; gg += 40 * k; b += 70 * k; }
      const i = (y * gw + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = edge * 235;
    }
    g.putImageData(img, 0, 0);
    c.drawImage(cv, 0, 0, W, H);
  }

  function paintRoad(c, dpr) {
    const trace = (cc) => { cc.beginPath(); GROUND.pts.forEach(([x, y], i) => (i ? cc.lineTo(x, y) : cc.moveTo(x, y))); };
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.save(); c.translate(3, 5); c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = PATH_W + 16; trace(c); c.stroke(); c.restore();
    c.strokeStyle = '#17130f'; c.lineWidth = PATH_W + 13; trace(c); c.stroke();
    c.strokeStyle = '#80776a'; c.lineWidth = PATH_W + 9; trace(c); c.stroke();
    c.strokeStyle = '#4c453c'; c.lineWidth = PATH_W + 4; trace(c); c.stroke();
    // slab surface painted on a separate layer and masked to the road
    const layer = makeCanvas(W * dpr, H * dpr);
    const l = layer.getContext('2d');
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tw = W / 3, th = H / 3;
    const tcv = makeCanvas(tw, th), tg = tcv.getContext('2d');
    const img = tg.createImageData(tw, th);
    const n = makeNoise(91, 64);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const f = fbm(n, x / 10, y / 10, 4);
      const v = 72 + f * 48;
      const i = (y * tw + x) * 4;
      img.data[i] = v + 6; img.data[i + 1] = v; img.data[i + 2] = v - 10; img.data[i + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    l.drawImage(tcv, 0, 0, W, H);
    const rng = mulberry32(4242);
    const hw = PATH_W / 2 - 1;
    for (let d = 0; d < GROUND.len; d += 24) {
      const p = posAt(GROUND, d), q = posAt(GROUND, d + 24);
      const nx = -Math.sin(p.ang), ny = Math.cos(p.ang);
      // each slab gets its own tone
      const tone = rng();
      l.fillStyle = tone < 0.5 ? `rgba(0,0,0,${tone * 0.25})` : `rgba(255,240,215,${(tone - 0.5) * 0.12})`;
      for (const side of [-1, 1]) {
        l.beginPath();
        l.moveTo(p.x, p.y); l.lineTo(p.x + nx * hw * side, p.y + ny * hw * side);
        l.lineTo(q.x + nx * hw * side, q.y + ny * hw * side); l.lineTo(q.x, q.y); l.fill();
      }
      // bevelled seams
      l.strokeStyle = 'rgba(15,12,9,0.7)'; l.lineWidth = 1.4;
      l.beginPath(); l.moveTo(p.x + nx * hw, p.y + ny * hw); l.lineTo(p.x - nx * hw, p.y - ny * hw); l.stroke();
      l.strokeStyle = 'rgba(255,240,210,0.16)'; l.lineWidth = 0.8;
      l.beginPath(); l.moveTo(p.x + nx * hw + 1, p.y + ny * hw + 1); l.lineTo(p.x - nx * hw + 1, p.y - ny * hw + 1); l.stroke();
      if (rng() < 0.35) {
        let x = p.x + nx * rand(-hw, hw) * 0.8, y = p.y + ny * rand(-hw, hw) * 0.8, a = rng() * TAU;
        l.strokeStyle = 'rgba(12,10,8,0.55)'; l.lineWidth = 0.9;
        l.beginPath(); l.moveTo(x, y);
        for (let k = 0; k < 4; k++) { a += rand(-0.8, 0.8); x += Math.cos(a) * 5; y += Math.sin(a) * 5; l.lineTo(x, y); }
        l.stroke();
      }
      if (rng() < 0.08) {
        const px = p.x + nx * rand(-hw, hw) * 0.6, py = p.y + ny * rand(-hw, hw) * 0.6;
        const g = l.createRadialGradient(px - 2, py - 2, 1, px, py, 9);
        g.addColorStop(0, 'rgba(120,110,130,0.55)'); g.addColorStop(1, 'rgba(20,18,24,0.5)');
        l.fillStyle = g; l.beginPath(); l.ellipse(px, py, 9, 5, p.ang, 0, TAU); l.fill();
      }
    }
    // centre seam and worn tracks
    l.setLineDash([]);
    l.strokeStyle = 'rgba(15,12,9,0.45)'; l.lineWidth = 1.2; trace(l); l.stroke();
    for (const off of [-11, 11]) {
      l.save(); l.strokeStyle = 'rgba(0,0,0,0.12)'; l.lineWidth = 6;
      l.beginPath();
      for (let d = 0; d <= GROUND.len; d += 6) { const p = posAt(GROUND, d); const x = p.x - Math.sin(p.ang) * off, y = p.y + Math.cos(p.ang) * off; d ? l.lineTo(x, y) : l.moveTo(x, y); }
      l.stroke(); l.restore();
    }
    // hazard chevrons before the gate
    for (const d of [GROUND.len - 150, GROUND.len - 135]) {
      const p = posAt(GROUND, d);
      l.save(); l.translate(p.x, p.y); l.rotate(p.ang);
      l.fillStyle = 'rgba(220,170,30,0.75)'; l.fillRect(-4, -hw, 8, hw * 2);
      l.fillStyle = 'rgba(20,16,10,0.85)';
      for (let k = -hw; k < hw; k += 8) { l.beginPath(); l.moveTo(-4, k); l.lineTo(4, k + 4); l.lineTo(4, k + 8); l.lineTo(-4, k + 4); l.fill(); }
      l.restore();
    }
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    l.globalCompositeOperation = 'destination-in';
    l.lineJoin = 'round'; l.lineCap = 'round'; l.strokeStyle = '#000'; l.lineWidth = PATH_W - 1;
    trace(l); l.stroke();
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(layer, 0, 0); c.restore();
  }

  function paintSpire(c, x, y, h) {
    // Tyranid capillary tower: a bulbous root mass with a curved, ribbed spine
    const w = h * 0.22, lean = h * 0.25;
    c.save(); c.translate(x, y); c.rotate(0.6);
    const sg = c.createLinearGradient(0, 0, h * 1.2, 0);
    sg.addColorStop(0, 'rgba(0,0,0,0.5)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = sg; c.beginPath(); c.moveTo(0, -w); c.quadraticCurveTo(h * 0.6, -w * 0.6, h * 1.2, 0); c.quadraticCurveTo(h * 0.6, w * 0.6, 0, w); c.fill();
    c.restore();
    c.lineCap = 'round';
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.2;
      for (const [col, lw] of [['#1e0a1e', 4], ['#6a2a5e', 2.2]]) {
        c.strokeStyle = col; c.lineWidth = lw;
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * w * 1.6, y + Math.sin(a) * w * 0.9, x + Math.cos(a + 0.4) * w * 2.6, y + Math.sin(a + 0.4) * w * 1.4); c.stroke();
      }
    }
    c.fillStyle = domeFill(c, x, y - w * 0.4, w * 1.4, '#7a2e66');
    c.beginPath(); c.ellipse(x, y - w * 0.3, w * 1.4, w * 0.95, 0, 0, TAU); c.fill();
    // the spine: built from stacked, shrinking chitin rings along a curve
    const n = 14;
    for (let i = n; i >= 0; i--) {
      const k = i / n;
      const px = x + lean * k * k, py = y - w * 0.5 - h * k;
      const r = w * (1 - k * 0.85);
      c.fillStyle = domeFill(c, px, py, r, i % 2 ? '#8a3a76' : '#e4d0b4');
      c.beginPath(); c.ellipse(px, py, r, r * 0.55, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(20,4,18,0.6)'; c.lineWidth = 0.7; c.stroke();
    }
    // spurs and the glowing maw at the tip
    c.fillStyle = '#e8dcc0';
    for (const k of [0.3, 0.5, 0.7]) {
      const px = x + lean * k * k, py = y - w * 0.5 - h * k, r = w * (1 - k * 0.85);
      c.beginPath(); c.moveTo(px - r, py); c.lineTo(px - r - w * 0.8, py - w * 0.6); c.lineTo(px - r * 0.6, py - 1); c.fill();
    }
    const tx = x + lean, ty = y - w * 0.5 - h;
    blob(c, tx, ty, w * 0.35, w * 0.18, '#ffb0e0');
  }

  function paintPillar(c, x, y, h) {
    const r = h > 20 ? 9 : 6;
    c.save(); c.translate(x, y); c.rotate(0.6);
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(0, -r, h * 0.9, r * 2);
    c.restore();
    box(c, x - r - 3, y - 3, r * 2 + 6, 8, 5, '#6c6458', '#3d372f');
    const g = c.createLinearGradient(x - r, 0, x + r, 0);
    g.addColorStop(0, '#9a9080'); g.addColorStop(0.4, '#6e665a'); g.addColorStop(1, '#2e2a24');
    c.fillStyle = g; c.fillRect(x - r, y - h, r * 2, h);
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1;
    for (let k = -r + 3; k < r; k += 4) { c.beginPath(); c.moveTo(x + k, y - h); c.lineTo(x + k, y); c.stroke(); }
    // broken top
    c.fillStyle = '#8a8172';
    c.beginPath(); c.moveTo(x - r, y - h); c.lineTo(x - r * 0.3, y - h - 4); c.lineTo(x + r * 0.2, y - h + 1); c.lineTo(x + r, y - h - 3); c.lineTo(x + r, y - h + 3); c.lineTo(x - r, y - h + 3); c.fill();
  }

  function paintWall(c, x, y, len, h) {
    const rng = mulberry32(x * 13 + y);
    // rubble at the foot
    for (let k = 0; k < len / 3; k++) {
      const rx = x + rng() * len, ry = y + 8 + rng() * 10, s = 1.5 + rng() * 3.5;
      box(c, rx, ry, s, s * 0.8, s * 0.8, '#7a7164', '#433c33');
    }
    let cx = x;
    while (cx < x + len) {
      const w = 10 + rng() * 14, hh = h * (0.45 + rng() * 0.6);
      box(c, cx, y, Math.min(w, x + len - cx), 10, hh, '#7c7366', '#4a433a');
      // gothic arched window on the south face
      const k = hh * 0.6;
      if (k > 11 && w > 14) {
        const wx = cx + w / 2, wy = y + 10 - k + 3;
        c.fillStyle = '#140f0c';
        c.beginPath(); c.moveTo(wx - 3, wy + k - 5); c.lineTo(wx - 3, wy + 3); c.arc(wx, wy + 3, 3, Math.PI, 0); c.lineTo(wx + 3, wy + k - 5); c.fill();
        c.fillStyle = 'rgba(255,120,40,0.18)'; c.fillRect(wx - 2, wy + 2, 4, k - 8);
      }
      // stone courses on the face
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.8;
      for (let yy = y + 10 - k + 4; yy < y + 10; yy += 4) { c.beginPath(); c.moveTo(cx, yy); c.lineTo(cx + w, yy); c.stroke(); }
      cx += w;
    }
    // a fallen skull ornament
    dot(c, x + len * 0.7, y + 18, 2.6, '#d9d2c0');
    dot(c, x + len * 0.7 - 0.9, y + 17.6, 0.6, '#1a1410'); dot(c, x + len * 0.7 + 0.9, y + 17.6, 0.6, '#1a1410');
  }

  function paintWreck(c, x, y) {
    c.save(); c.translate(x, y); c.rotate(-0.35);
    c.fillStyle = 'rgba(0,0,0,0.45)'; rr(c, -20, -10, 46, 30, 4); c.fill();
    // tracks, one thrown
    c.fillStyle = '#1a1816'; rr(c, -24, -16, 46, 7, 2); c.fill();
    c.save(); c.rotate(0.15); rr(c, -22, 10, 40, 7, 2); c.fill(); c.restore();
    c.strokeStyle = '#2e2b27'; c.lineWidth = 1;
    for (let k = -22; k < 20; k += 3) { c.beginPath(); c.moveTo(k, -16); c.lineTo(k, -9); c.stroke(); }
    // charred hull
    c.fillStyle = linFill(c, 0, -9, 0, 9, '#3a352f', 25, -25); rr(c, -21, -9.5, 42, 19, 3); c.fill();
    c.fillStyle = '#5a3a24'; for (const [a, b, r] of [[-12, -4, 4], [6, 3, 5], [14, -5, 3]]) blob(c, a, b, r, r * 0.7, 'rgba(110,60,30,0.55)');
    c.fillStyle = '#26221e'; rr(c, -8, -6, 12, 12, 2); c.fill();
    c.fillStyle = '#100d0b'; c.beginPath(); c.arc(-2, 0, 3.5, 0, TAU); c.fill();
    // faded Imperial eagle on the hull
    c.strokeStyle = 'rgba(200,170,80,0.4)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(10, -3); c.lineTo(14, 0); c.lineTo(10, 3); c.moveTo(14, 0); c.lineTo(18, 0); c.stroke();
    c.restore();
  }

  function paintTrap(c, x, y) {
    c.fillStyle = 'rgba(0,0,0,0.4)'; blob(c, x + 4, y + 4, 9, 4, 'rgba(0,0,0,0.4)');
    c.lineCap = 'butt';
    for (const [a, l] of [[0.5, 11], [-0.6, 11], [1.6, 8]]) {
      c.strokeStyle = '#2a2724'; c.lineWidth = 3.2;
      c.beginPath(); c.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l * 0.7 - 2); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.7 - 2); c.stroke();
      c.strokeStyle = 'rgba(170,160,145,0.6)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l * 0.7 - 3); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.7 - 3); c.stroke();
    }
  }

  function paintDeck(c) {
    // Imperial deck plating in front of the walls
    const x0 = 818, x1 = 884;
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x0 - 2, 146, x1 - x0 + 4, H - 146);
    for (let y = 150; y < H; y += 30) {
      for (let x = x0; x < x1; x += 33) {
        c.fillStyle = linFill(c, x, y, x + 32, y + 29, '#4c4a46', 22, -22);
        c.fillRect(x, y, 32, 29);
        c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, 31, 28);
        c.fillStyle = 'rgba(255,255,255,0.07)';
        for (let k = 0; k < 4; k++) c.fillRect(x + 4 + k * 7, y + 4, 2, 21);
        for (const [a, b] of [[3, 3], [29, 3], [3, 26], [29, 26]]) { dot(c, x + a, y + b, 1, '#2a2826'); dot(c, x + a - 0.3, y + b - 0.3, 0.4, 'rgba(255,255,255,0.4)'); }
      }
    }
    // hazard border
    c.save();
    c.beginPath(); c.rect(x0 - 6, 146, 6, H - 146); c.clip();
    c.fillStyle = '#c99a20'; c.fillRect(x0 - 6, 146, 6, H - 146);
    c.fillStyle = '#17130e';
    for (let y = 140; y < H; y += 10) { c.beginPath(); c.moveTo(x0 - 6, y); c.lineTo(x0, y + 5); c.lineTo(x0, y + 10); c.lineTo(x0 - 6, y + 5); c.fill(); }
    c.restore();
  }

  function paintFortress(c) {
    const x0 = 884;
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(x0 - 10, 0, 14, H);
    c.fillStyle = linFill(c, x0, 0, W, 0, '#6a6256', 20, -30);
    c.fillRect(x0, 0, W - x0, H);
    // stone courses
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 1;
    for (let y = 0; y < H; y += 12) {
      c.beginPath(); c.moveTo(x0, y); c.lineTo(W, y); c.stroke();
      for (let x = x0 + ((y / 12) % 2) * 9; x < W; x += 18) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 12); c.stroke(); }
    }
    // crenellations along the inner edge
    for (let y = 2; y < H; y += 20) box(c, x0 - 4, y, 9, 11, 9, '#857c6e', '#4a443b');
    // round bastions with braziers
    for (const by of [300, 500]) {
      blob(c, 930, by + 6, 40, 36, 'rgba(0,0,0,0.4)');
      c.fillStyle = domeFill(c, 924, by, 36, '#6e665a'); c.beginPath(); c.arc(924, by, 36, 0, TAU); c.fill();
      c.fillStyle = '#4a443b'; c.beginPath(); c.arc(924, by, 26, 0, TAU); c.fill();
      for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; box(c, 924 + Math.cos(a) * 31 - 3, by + Math.sin(a) * 31 - 3, 6, 6, 6, '#8a8174', '#4a443b'); }
      c.fillStyle = '#2a2622'; c.beginPath(); c.arc(924, by, 6, 0, TAU); c.fill();
      // red banner with a gold skull
      c.fillStyle = '#7a1414'; c.fillRect(890, by - 14, 10, 30);
      c.fillStyle = '#c9a24a'; c.fillRect(890, by - 14, 10, 2); dot(c, 895, by - 2, 2.4, '#e9dcc0');
      c.beginPath(); c.moveTo(890, by + 16); c.lineTo(895, by + 22); c.lineTo(900, by + 16); c.fillStyle = '#7a1414'; c.fill();
    }
    // gatehouse over the road
    const gy = 110;
    const tg = c.createLinearGradient(870, gy, 900, gy);
    tg.addColorStop(0, 'rgba(0,0,0,0)'); tg.addColorStop(1, 'rgba(0,0,0,0.9)');
    c.fillStyle = tg; c.fillRect(866, gy - 24, 30, 48);
    box(c, 890, gy - 64, 70, 128, 22, '#7a7266', '#4a443b');
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(898, gy - 70, 56, 112);
    // gilded aquila
    c.save(); c.translate(926, gy - 14);
    c.fillStyle = goldFill(c, -22, -10, 22, 10);
    for (const sd of [-1, 1]) {
      c.beginPath(); c.moveTo(0, -2); c.lineTo(sd * 22, -12); c.lineTo(sd * 18, -6); c.lineTo(sd * 22, -4); c.lineTo(sd * 15, 0); c.lineTo(sd * 18, 4); c.lineTo(sd * 4, 4); c.closePath(); c.fill();
    }
    dot(c, -3, -5, 2.6, '#e0b84a'); dot(c, 3, -5, 2.6, '#e0b84a');
    c.fillStyle = goldFill(c, -3, -2, 3, 10); c.fillRect(-2.5, -2, 5, 12);
    c.restore();
    for (let k = 0; k < 5; k++) box(c, 892 + k * 14, gy - 66, 8, 6, 7, '#8a8174', '#4a443b');
  }

  const bg = document.createElement('canvas');
  function renderBackground(dpr) {
    bg.width = W * dpr; bg.height = H * dpr;
    const c = bg.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintGround(c);
    paintCreep(c);
    paintRoad(c, dpr);
    paintDeck(c);
    for (const [x, y] of DECOR.traps) paintTrap(c, x, y);
    paintWreck(c, DECOR.wreck[0], DECOR.wreck[1]);
    for (const [x, y, len, h] of DECOR.walls) paintWall(c, x, y, len, h);
    for (const [x, y, h] of DECOR.pillars) paintPillar(c, x, y, h);
    for (const [x, y, h] of DECOR.spires) paintSpire(c, x, y, h);
    // scattered bones near the hive's maw
    const rng = mulberry32(606);
    for (let i = 0; i < 26; i++) {
      const x = 20 + rng() * 300, y = rng() * 380;
      if (distToGround(x, y) < 30) continue;
      c.strokeStyle = 'rgba(225,215,190,0.75)'; c.lineWidth = 1.4; c.lineCap = 'round';
      const a = rng() * TAU;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5); c.stroke();
      if (rng() < 0.3) { dot(c, x + 3, y - 3, 2.2, '#d9d0bb'); dot(c, x + 2.3, y - 3.4, 0.5, '#1a1410'); dot(c, x + 3.7, y - 3.4, 0.5, '#1a1410'); }
    }
    paintFortress(c);
    // flight lane: faint wing-beats in the dust
    for (let d = 140; d < AIR.end; d += 170) {
      const p = posAt(AIR, d);
      c.save(); c.translate(p.x, p.y); c.rotate(p.ang);
      c.fillStyle = 'rgba(200,150,240,0.22)';
      c.beginPath(); c.moveTo(8, 0); c.lineTo(-5, -7); c.lineTo(-1, 0); c.lineTo(-5, 7); c.fill();
      c.restore();
    }
  }

  // Atmosphere layers that drift over everything.
  const fogCv = (() => {
    const S = 192, cv = makeCanvas(S, S), g = cv.getContext('2d');
    const img = g.createImageData(S, S);
    const n = makeNoise(303, 8);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const f = fbm(n, (x / S) * 8, (y / S) * 8, 4);
      const i = (y * S + x) * 4;
      img.data[i] = 170; img.data[i + 1] = 160; img.data[i + 2] = 185; img.data[i + 3] = clamp((f - 0.42) * 2.4, 0, 1) * 255;
    }
    g.putImageData(img, 0, 0);
    return cv;
  })();
  const vignetteCv = (() => {
    const cv = makeCanvas(W, H), g = cv.getContext('2d');
    const v = g.createRadialGradient(W * 0.45, H * 0.45, 200, W / 2, H / 2, 640);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    const t = g.createLinearGradient(0, 0, 0, H);
    t.addColorStop(0, 'rgba(60,30,80,0.10)'); t.addColorStop(1, 'rgba(70,35,10,0.10)');
    g.fillStyle = t; g.fillRect(0, 0, W, H);
    return cv;
  })();
  const ash = Array.from({ length: 90 }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, s: 0.6 + Math.random() * 1.6, v: 0.2 + Math.random() * 0.5, spore: i < 18 }));

  // Splat and smoke sprites.
  const SPLAT_COLORS = { '#7a2d6a': '122,45,106', '#5c8a2a': '92,138,42', '#9a3a7a': '154,58,122', '#4a6a1a': '74,106,26' };
  function splatSprite(color, v) {
    return cached(`splat|${color}|${v}`, 14, (c) => {
      const rng = mulberry32(v * 97 + 3);
      c.fillStyle = color;
      for (let k = 0; k < 9; k++) { const a = rng() * TAU, d = rng() * 6; c.beginPath(); c.arc(Math.cos(a) * d, Math.sin(a) * d, 2 + rng() * 4, 0, TAU); c.fill(); }
      for (let k = 0; k < 10; k++) { const a = rng() * TAU, d = 7 + rng() * 6; c.beginPath(); c.arc(Math.cos(a) * d, Math.sin(a) * d, 0.5 + rng() * 1.2, 0, TAU); c.fill(); }
      c.globalCompositeOperation = 'source-atop';
      spec(c, -2, -2, 3, 1.6, 0.3);
    }, { shade: false, outline: 0, shadow: false });
  }
  const scorchSprite = () => cached('scorch', 24, (c) => {
    const g = c.createRadialGradient(0, 0, 2, 0, 0, 24);
    g.addColorStop(0, 'rgba(8,6,5,0.85)'); g.addColorStop(0.6, 'rgba(20,14,10,0.5)'); g.addColorStop(1, 'rgba(20,14,10,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, 24, 0, TAU); c.fill();
    const rng = mulberry32(5);
    c.strokeStyle = 'rgba(10,8,6,0.6)'; c.lineWidth = 1.2;
    for (let k = 0; k < 10; k++) { const a = rng() * TAU; c.beginPath(); c.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); c.lineTo(Math.cos(a) * (16 + rng() * 8), Math.sin(a) * (16 + rng() * 8)); c.stroke(); }
  }, { shade: false, outline: 0, shadow: false });
  const smokeSprite = () => cached('smoke', 16, (c) => {
    const rng = mulberry32(17);
    for (let k = 0; k < 7; k++) {
      const x = (rng() - 0.5) * 12, y = (rng() - 0.5) * 12, r = 5 + rng() * 6;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(120,115,110,0.45)'); g.addColorStop(1, 'rgba(120,115,110,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
  }, { shade: false, outline: 0, shadow: false });

  // ------------------------------------------------------- tyranid artwork
  // Each drawer faces +x and is baked into animation frames, so detail is free at runtime.
  const NID = { skin: '#e6d8b8', skinD: '#a8987a', cara: '#6a2470', caraL: '#9a48a0', caraD: '#33103a', claw: '#f4ecd8', eye: '#ffd23a', gun: '#5a2846' };

  function leg(c, ax, ay, ang, len, swing, w) {
    const a1 = ang + swing;
    const kx = ax + Math.cos(a1) * len * 0.55, ky = ay + Math.sin(a1) * len * 0.55;
    const a2 = a1 + (ay >= 0 ? 0.7 : -0.7);
    const fx = kx + Math.cos(a2) * len * 0.5, fy = ky + Math.sin(a2) * len * 0.5;
    c.strokeStyle = NID.caraD; c.lineWidth = w + 1.2;
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(kx, ky); c.lineTo(fx, fy); c.stroke();
    c.strokeStyle = NID.skinD; c.lineWidth = w;
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(kx, ky); c.lineTo(fx, fy); c.stroke();
    // chitin plate on the upper leg and a claw tip
    c.strokeStyle = NID.cara; c.lineWidth = w * 0.9;
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + (kx - ax) * 0.7, ay + (ky - ay) * 0.7); c.stroke();
    dot(c, fx, fy, w * 0.45, NID.claw);
  }
  // pairs: [anchorX, halfWidth, length, forwardTilt]
  function legs(c, t, pairs, col, width) {
    c.lineCap = 'round'; c.lineJoin = 'round';
    pairs.forEach(([ax, hw, len, tilt], i) => {
      for (const sd of [-1, 1]) {
        const ph = t + i * Math.PI + (sd > 0 ? Math.PI : 0);
        leg(c, ax, sd * hw, sd * (Math.PI / 2 - tilt), len, Math.sin(ph) * 0.45 * sd, width);
      }
    });
  }
  function talon(c, ax, ay, sd, len) {
    const ex = ax + len * 0.45, ey = ay + sd * len * 0.2;
    c.strokeStyle = NID.cara; c.lineWidth = Math.max(1.4, len * 0.14); c.lineCap = 'round';
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ex, ey); c.stroke();
    c.fillStyle = linFill(c, ex, ey - sd * 3, ex + len * 0.5, ey + sd * 2, NID.claw, 10, -70);
    c.beginPath();
    c.moveTo(ex, ey - sd * 1);
    c.quadraticCurveTo(ex + len * 0.62, ey + sd * len * 0.2, ex + len * 0.58, ey - sd * len * 0.28);
    c.quadraticCurveTo(ex + len * 0.35, ey + sd * len * 0.02, ex, ey + sd * 1.3);
    c.fill();
    c.strokeStyle = 'rgba(80,60,40,0.5)'; c.lineWidth = 0.5; c.stroke();
  }
  function plated(c, x, y, rx, ry, n, col) {
    shaded(c, x, y, rx, ry, col || NID.cara);
    c.strokeStyle = 'rgba(25,6,28,0.75)'; c.lineWidth = 0.9;
    for (let k = 1; k < n; k++) {
      const px = x - rx + (2 * rx * k) / n;
      const h = ry * Math.sqrt(1 - Math.pow((px - x) / rx, 2)) * 0.92;
      c.beginPath(); c.moveTo(px, y - h); c.quadraticCurveTo(px + rx * 0.18, y, px, y + h); c.stroke();
    }
    spec(c, x - rx * 0.25, y - ry * 0.4, rx * 0.45, ry * 0.18, 0.4);
    // central ridge
    c.strokeStyle = 'rgba(255,220,255,0.18)'; c.lineWidth = 0.7;
    c.beginPath(); c.moveTo(x - rx * 0.85, y); c.lineTo(x + rx * 0.85, y); c.stroke();
  }
  function eyes(c, x, w, r, col) {
    for (const sd of [-1, 1]) { dot(c, x, sd * w, r * 1.6, 'rgba(0,0,0,0.6)'); dot(c, x, sd * w, r, col || NID.eye); dot(c, x - r * 0.3, sd * w - r * 0.3, r * 0.35, '#fff'); }
  }
  function wings(c, t, span, len, col) {
    const k = 0.5 + 0.5 * Math.abs(Math.sin(t));
    for (const sd of [-1, 1]) {
      const pts = [[2, sd * 2], [-len * 0.2, sd * span * k], [-len * 0.55, sd * span * k * 0.85], [-len * 0.45, sd * span * k * 0.5], [-len * 0.8, sd * span * k * 0.45], [-len * 0.4, sd * 2]];
      const g = c.createLinearGradient(0, 0, 0, sd * span * k);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(160,70,140,0.85)');
      c.fillStyle = g;
      c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
      c.strokeStyle = NID.caraL; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(2, sd * 2); c.lineTo(-len * 0.2, sd * span * k); c.lineTo(-len * 0.55, sd * span * k * 0.85); c.stroke();
      c.lineWidth = 0.6;
      c.beginPath(); c.moveTo(-len * 0.2, sd * span * k); c.lineTo(-len * 0.45, sd * span * k * 0.5); c.moveTo(-len * 0.2, sd * span * k); c.lineTo(-len * 0.8, sd * span * k * 0.45); c.stroke();
    }
  }
  function tail(c, x0, len, t, w, col) {
    c.lineCap = 'round';
    for (const [cc, ww] of [[NID.caraD, w + 1.2], [col || NID.skinD, w]]) {
      c.strokeStyle = cc; c.lineWidth = ww;
      c.beginPath(); c.moveTo(x0, 0);
      c.quadraticCurveTo(x0 - len * 0.5, Math.sin(t) * len * 0.15, x0 - len, Math.sin(t + 1) * len * 0.2);
      c.stroke();
    }
  }
  function head(c, x, rx, ry, col) {
    plated(c, x, 0, rx, ry, 2, col || NID.cara);
    shaded(c, x + rx * 0.55, 0, rx * 0.5, ry * 0.65, NID.skin);
    c.strokeStyle = 'rgba(60,20,30,0.7)'; c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(x + rx * 0.9, -ry * 0.3); c.lineTo(x + rx * 1.05, 0); c.lineTo(x + rx * 0.9, ry * 0.3); c.stroke();
  }

  const DRAW = {
    ripper(c, t) {
      for (const [ox, oy, ph] of [[3, 0, 0], [-4, 4, 2], [-3, -4.5, 4]]) {
        c.save(); c.translate(ox, oy);
        for (let s = 3; s >= 0; s--) shaded(c, -s * 2.2, Math.sin(t * 2 + ph + s) * 1.2, 2.3 - s * 0.3, 2 - s * 0.25, s ? '#9a4a72' : '#c26a8e');
        dot(c, 1.7, 0, 1, '#2a0820');
        for (const sd of [-1, 1]) dot(c, 1.9, sd * 0.6, 0.35, '#f4ecd8');
        c.restore();
      }
    },
    termagant(c, t) {
      legs(c, t, [[0, 2.5, 7, 0.4], [-3, 2.5, 7, -0.2]], NID.skinD, 1.1);
      shaded(c, -4, 0, 4.2, 3.4, NID.skin);
      plated(c, -4.2, 0, 3, 2.3, 2);
      plated(c, 0.5, 0, 3.4, 3.2, 2);
      head(c, 4, 2.8, 2.4);
      eyes(c, 5.2, 1, 0.5);
      steel(c, 1, 2.4, 7, 2.4, NID.gun);
      dot(c, 8, 3.6, 1, '#e07050');
    },
    hormagaunt(c, t) {
      legs(c, t, [[0, 2.2, 9, 0.5], [-3.5, 2.2, 9, -0.3]], NID.skinD, 1.1);
      tail(c, -7, 6, t, 1.4);
      shaded(c, -4.5, 0, 4, 3, NID.skin);
      plated(c, -4.5, 0, 2.8, 2, 2);
      plated(c, 0, 0, 3, 2.8, 2);
      head(c, 3.6, 2.4, 2.1);
      eyes(c, 4.8, 0.9, 0.5);
      talon(c, 1, -2.6, -1, 8);
      talon(c, 1, 2.6, 1, 8);
    },
    gargoyle(c, t) {
      wings(c, t * 2, 13, 12, 'rgba(90,25,85,0.95)');
      tail(c, -5, 7, t, 1.3);
      shaded(c, -3.5, 0, 3.2, 2.4, NID.skin);
      plated(c, 0, 0, 2.8, 2.6, 2);
      head(c, 3, 2.2, 2);
      eyes(c, 4.2, 0.8, 0.5, '#ff6b3b');
      steel(c, 0, 2, 5, 1.8, NID.gun);
    },
    genestealer(c, t) {
      const GS = '#4f5f9a', GD = '#36427a';
      legs(c, t, [[-1, 2.5, 8, 0.4], [-4, 2.5, 8, -0.3]], GD, 1.3);
      shaded(c, -5, 0, 3.8, 3, GS);
      plated(c, -4.5, 0, 3, 2.3, 2);
      shaded(c, 0, 0, 3.4, 3.2, GS);
      for (const sd of [-1, 1]) {
        c.lineCap = 'round';
        c.strokeStyle = '#1e2448'; c.lineWidth = 2.4;
        c.beginPath(); c.moveTo(1, sd * 2.5); c.lineTo(5, sd * 6); c.lineTo(9, sd * 5); c.stroke();
        c.strokeStyle = GS; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(1, sd * 2.5); c.lineTo(5, sd * 6); c.lineTo(9, sd * 5); c.stroke();
        c.beginPath(); c.moveTo(1.5, sd * 1.5); c.lineTo(6, sd * 3); c.stroke();
        c.strokeStyle = NID.claw; c.lineWidth = 0.9;
        for (const k of [-1, 0, 1]) { c.beginPath(); c.moveTo(9, sd * 5); c.lineTo(11.8, sd * 5 + k * 1.4); c.stroke(); }
      }
      shaded(c, 4.2, 0, 3.3, 3, '#8a86c0');
      c.strokeStyle = 'rgba(40,40,90,0.6)'; c.lineWidth = 0.6;
      for (const k of [-1, 0, 1]) { c.beginPath(); c.moveTo(2, k * 1.2); c.lineTo(5, k * 0.9); c.stroke(); }
      eyes(c, 6.2, 1.1, 0.6);
    },
    warrior(c, t) {
      legs(c, t, [[-4, 3.5, 12, 0.1]], NID.skinD, 2);
      tail(c, -10, 6, t, 2);
      shaded(c, -6.5, 0, 5.5, 4.3, NID.skin);
      plated(c, -6.5, 0, 4.2, 3.2, 3);
      plated(c, 0, 0, 4.8, 4.4, 3);
      steel(c, 0, 4.2, 10, 3.2, '#7a3060');
      dot(c, 10.5, 5.8, 1.4, '#9dff5a');
      c.strokeStyle = NID.caraD; c.lineWidth = 3;
      c.beginPath(); c.moveTo(1, -4.5); c.lineTo(14, -7); c.stroke();
      c.strokeStyle = NID.claw; c.lineWidth = 1.8;
      c.beginPath(); c.moveTo(1, -4.5); c.lineTo(14, -7); c.stroke();
      talon(c, 3, -3, -1, 11);
      talon(c, 3, 3, 1, 11);
      c.fillStyle = linFill(c, 0, -5, 0, 5, NID.claw, 10, -60);
      for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(5.5, sd * 1); c.lineTo(-0.5, sd * 6); c.lineTo(4, sd * 2.5); c.fill(); }
      head(c, 6.3, 3.4, 3);
      eyes(c, 8, 1.1, 0.6);
    },
    lictor(c, t) {
      const LC = '#4a6a40';
      legs(c, t, [[-1, 2.5, 14, 0.4], [-6, 2.5, 13, -0.3]], NID.skinD, 1.1);
      tail(c, -10, 5, t, 1.5);
      shaded(c, -6, 0, 5.5, 3, NID.skin);
      plated(c, -6, 0, 4, 2.2, 3, LC);
      plated(c, 0, 0, 4, 3.3, 2, LC);
      talon(c, 1, -3, -1, 13);
      talon(c, 1, 3, 1, 13);
      head(c, 5, 3, 2.6, LC);
      c.strokeStyle = NID.skin; c.lineWidth = 0.9; c.lineCap = 'round';
      for (const k of [-1.2, -0.4, 0.4, 1.2]) { c.beginPath(); c.moveTo(7.5, k); c.quadraticCurveTo(10, k * 2 + Math.sin(t * 2 + k) * 1.5, 12, k * 1.6); c.stroke(); }
      eyes(c, 6.2, 1.2, 0.6, '#c8ff6a');
    },
    zoanthrope(c, t) {
      tail(c, -3, 9, t * 3, 3, NID.skinD);
      c.strokeStyle = NID.skinD; c.lineWidth = 1;
      for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(-1, sd * 3); c.lineTo(3, sd * 6); c.stroke(); }
      shaded(c, 1, 0, 7, 6.5, '#e4c0cc');
      c.strokeStyle = '#a07088'; c.lineWidth = 0.9;
      for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(-1 + k * 1.2, 0, 2 + k * 1.3, Math.PI * 0.6, Math.PI * 1.4); c.stroke(); }
      c.beginPath(); c.moveTo(-5, 0); c.lineTo(6, 0); c.stroke();
      spec(c, -1, -3, 3, 1.5, 0.35);
      plated(c, 6, 0, 2.6, 3.4, 2);
      eyes(c, 7.2, 1.3, 0.8, '#9dff7a');
    },
    harpy(c, t) {
      wings(c, t * 2, 26, 22, 'rgba(85,22,80,0.95)');
      tail(c, -9, 14, t, 2.2);
      shaded(c, -8, 0, 6, 4.5, NID.skin);
      plated(c, -8, 0, 4.5, 3.4, 3);
      plated(c, 0, 0, 5, 5, 3);
      steel(c, 0, -8, 11, 3, NID.gun);
      steel(c, 0, 5, 11, 3, NID.gun);
      head(c, 6.5, 3.5, 3.2);
      eyes(c, 8.2, 1.3, 0.7, '#ff6b3b');
    },
    carnifex(c, t) {
      legs(c, t, [[-2, 6, 13, 0.3], [-9, 6, 13, -0.3]], NID.skinD, 3);
      tail(c, -14, 8, t, 3.2);
      shaded(c, -22, Math.sin(t + 1) * 1.6, 2.8, 2.8, NID.claw);
      shaded(c, -8, 0, 7, 6, NID.skin);
      plated(c, -1, 0, 9, 8, 4);
      c.fillStyle = linFill(c, 0, -2, 0, 2, NID.claw, 10, -50);
      for (let k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(k * 2.4 - 1.2, -1); c.lineTo(k * 2.4 - 3.4, 0); c.lineTo(k * 2.4 - 1.2, 1); c.fill(); }
      talon(c, 2, -7.5, -1, 13);
      talon(c, 2, 7.5, 1, 13);
      talon(c, 5, -5, -1, 15);
      talon(c, 5, 5, 1, 15);
      head(c, 8.5, 4, 3.6, NID.caraD);
      c.fillStyle = NID.claw;
      c.beginPath(); c.moveTo(11, -2); c.lineTo(6, -5.5); c.lineTo(7, -1); c.fill();
      c.beginPath(); c.moveTo(11, 2); c.lineTo(6, 5.5); c.lineTo(7, 1); c.fill();
      eyes(c, 10.4, 1.4, 0.8, '#ff4b2b');
    },
    tervigon(c, t) {
      legs(c, t, [[3, 7, 15, 0.4], [-4, 8, 16, 0], [-11, 8, 15, -0.4]], NID.skinD, 2.8);
      shaded(c, -11, 0, 13, 11, '#dcbab2');
      c.strokeStyle = 'rgba(120,40,70,0.45)'; c.lineWidth = 1;
      for (const k of [-6, -1, 4]) { c.beginPath(); c.moveTo(-22, k); c.quadraticCurveTo(-12, k * 1.6, -2, k * 0.5); c.stroke(); }
      for (const [x, y] of [[-15, -4], [-9, 5], [-17, 4], [-7, -5]]) { blob(c, x, y, 2.8, 2, 'rgba(110,60,90,0.6)'); dot(c, x + 1.2, y, 0.5, NID.eye); }
      spec(c, -14, -5, 5, 2, 0.3);
      plated(c, 3, 0, 8, 8.5, 4);
      talon(c, 8, -5, -1, 8);
      talon(c, 8, 5, 1, 8);
      head(c, 11, 4, 3.6);
      eyes(c, 12.5, 1.3, 0.8);
    },
    tyrant(c, t) {
      legs(c, t, [[-4, 5, 16, 0.1]], NID.skinD, 3.2);
      tail(c, -12, 14, t, 3);
      shaded(c, -8, 0, 7, 6, NID.skin);
      plated(c, -8, 0, 5.5, 4.6, 3);
      plated(c, 1, 0, 7, 7, 4);
      for (const sd of [-1, 1]) {
        c.strokeStyle = NID.caraD; c.lineWidth = 3.6; c.beginPath(); c.moveTo(2, sd * 7); c.lineTo(17, sd * 11); c.stroke();
        c.strokeStyle = NID.claw; c.lineWidth = 2.2; c.beginPath(); c.moveTo(2, sd * 7); c.lineTo(17, sd * 11); c.stroke();
      }
      talon(c, 5, -5, -1, 15);
      talon(c, 5, 5, 1, 15);
      c.fillStyle = linFill(c, 0, -10, 0, 10, NID.claw, 10, -50);
      for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) {
        c.beginPath(); c.moveTo(9, sd * 1); c.lineTo(1 - k * 2, sd * (5 + k * 2.2)); c.lineTo(8 - k, sd * 2.5); c.fill();
      }
      head(c, 9.5, 4.2, 3.8);
      eyes(c, 11.4, 1.3, 0.8);
    },
    titan(c, t) {
      const r = 36;
      c.lineCap = 'round';
      for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) {
        const bx = (k - 1) * r * 0.8, sw = Math.sin(t + k * 2 + (sd > 0 ? Math.PI : 0)) * r * 0.3;
        for (const [col, w] of [[NID.caraD, 7], [NID.claw, 4.5]]) {
          c.strokeStyle = col; c.lineWidth = w;
          c.beginPath(); c.moveTo(bx, sd * r * 0.5);
          c.lineTo(bx + sw * 0.5, sd * r * 1.25); c.lineTo(bx + sw + r * 0.15, sd * r * 1.6); c.stroke();
        }
      }
      shaded(c, 0, 0, r * 1.5, r * 0.85, '#8a3a5c');
      for (let k = -2; k <= 1; k++) {
        shaded(c, k * r * 0.55, 0, r * 0.36, r * 0.62, NID.claw);
        plated(c, k * r * 0.55, 0, r * 0.24, r * 0.48, 2);
      }
      shaded(c, r * 1.35, 0, r * 0.45, r * 0.4, NID.claw);
      plated(c, r * 1.3, 0, r * 0.3, r * 0.26, 2);
      eyes(c, r * 1.5, r * 0.14, 2.6);
      for (const sd of [-1, 1]) {
        for (const [col, w] of [[NID.caraD, 5.5], [NID.claw, 3.5]]) {
          c.strokeStyle = col; c.lineWidth = w;
          c.beginPath(); c.moveTo(r * 1.2, sd * r * 0.35); c.quadraticCurveTo(r * 1.9, sd * r * 0.9, r * 2.1, sd * r * 0.3); c.stroke();
        }
      }
    },
  };

  const UNIT_HALF = { ripper: 12, termagant: 13, hormagaunt: 15, gargoyle: 17, genestealer: 15, warrior: 19, lictor: 19, zoanthrope: 15, harpy: 30, carnifex: 27, tervigon: 32, tyrant: 30, titan: 84 };
  const FRAMES = 12;
  function framesFor(key) { return key === 'titan' ? 8 : FRAMES; }
  function unitSprite(key, f) {
    const half = UNIT_HALF[key] * UNIT_SCALE;
    return cached(`u|${key}|${f}`, half, (c) => {
      c.scale(UNIT_SCALE, UNIT_SCALE);
      DRAW[key](c, (f / framesFor(key)) * TAU);
    }, { shadeR: half * 0.75, outline: key === 'titan' ? 1.6 : 0.9, ss: half > 40 ? 1.5 : SS });
  }
  function unitFrame(e) {
    const n = framesFor(e.u.key);
    const t = state.time * e.u.gait + e.phase;
    return unitSprite(e.u.key, Math.floor(((((t % TAU) + TAU) % TAU) / TAU) * n) % n);
  }
  function prebakeUnits() {
    for (const k in UNITS) for (let f = 0; f < framesFor(k); f++) unitSprite(k, f);
  }

  // ------------------------------------------------- space marine artwork
  // Top-down miniatures on bevelled bases, facing +x, weapon held on the right (+y).
  const MUZZLE = { bolter: [14.5, 3.2], boltpistol: [10, 3.4], heavybolter: [19.5, 3.7], missile: [16, 5.3], plasma: [14.5, 3.6], flamer: [12.5, 3.3], shotgun: [12.5, 3], sniper: [18.5, 2.8], staff: [14.5, 3.5] };

  function baseArt(c, r) {
    c.fillStyle = linFill(c, -r, -r, r, r, '#2c2824', 30, -30);
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    const g = c.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r * 0.9);
    g.addColorStop(0, '#5a5044'); g.addColorStop(1, '#2e2822');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, r * 0.86, 0, TAU); c.fill();
    const rng = mulberry32(Math.round(r * 10));
    for (let k = 0; k < 16; k++) { const a = rng() * TAU, d = rng() * r * 0.8; dot(c, Math.cos(a) * d, Math.sin(a) * d, 0.3 + rng() * 0.6, rng() < 0.5 ? '#7a6e5e' : '#1e1a16'); }
    c.strokeStyle = 'rgba(255,240,210,0.25)'; c.lineWidth = 0.7;
    c.beginPath(); c.arc(0, 0, r - 0.4, Math.PI * 1.0, Math.PI * 1.6); c.stroke();
  }

  function trimFill(c, T, x0, y0, x1, y1) {
    return T === '#d4af37' || T === '#c9b37e' ? goldFill(c, x0, y0, x1, y1) : linFill(c, x0, y0, x1, y1, T, 60, -40);
  }

  function weaponArt(c, w, T) {
    switch (w) {
      case 'bolter':
        steel(c, 0, 1.5, 11.5, 3.4);
        c.fillStyle = '#26272b'; c.fillRect(4, 4.6, 2, 2.4);
        steel(c, 11, 2.1, 2.6, 2.2, '#55565c');
        c.fillStyle = trimFill(c, T, 2, 1.5, 6, 2.5); c.fillRect(2.5, 1.5, 3, 1);
        break;
      case 'boltpistol':
        steel(c, 1.5, 2.2, 7, 2.4);
        break;
      case 'heavybolter':
        c.strokeStyle = goldFill(c, -9, 4, 1, 8); c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(1, 5.6); c.quadraticCurveTo(-5, 8.5, -9, 4); c.stroke();
        steel(c, -1, 1.2, 15, 5);
        steel(c, 13.5, 2.1, 5, 3.2, '#4c4d52');
        c.fillStyle = '#121214'; c.fillRect(18, 2.8, 1, 1.8);
        break;
      case 'missile':
        steel(c, -7, 2.8, 22, 5, '#3a4232');
        c.fillStyle = trimFill(c, T, 12, 2.8, 14, 7.8); c.fillRect(12, 2.8, 2, 5);
        dot(c, 15.2, 5.3, 1.8, '#0e0e10');
        break;
      case 'plasma':
        steel(c, -1, 1.5, 14, 4.2, '#2a2e36');
        for (let k = 0; k < 3; k++) { c.fillStyle = '#6fd6ff'; rr(c, 2 + k * 3.4, 1, 1.6, 5.2, 0.6); c.fill(); }
        dot(c, 14, 3.6, 1.7, '#bff0ff');
        break;
      case 'flamer':
        steel(c, 0, 1.8, 11, 3);
        shaded(c, 3, 5.8, 2, 1.8, '#8a2a10');
        dot(c, 12, 3.3, 1.1, '#ffa040');
        break;
      case 'chainsword':
        steel(c, 1, -4.8, 6, 2);
        steel(c, 0, 3.2, 3.5, 2.2, '#2a2a2e');
        steel(c, 3, 3, 13, 2.6, '#9aa0a8');
        c.fillStyle = '#2a2a2a';
        for (let x = 4; x < 16; x += 1.6) c.fillRect(x, 5.4, 0.8, 1);
        break;
      case 'claws':
        for (const sd of [-1, 1]) {
          steel(c, 1.5, sd > 0 ? 3 : -6, 4, 3, '#45464c');
          c.strokeStyle = '#d8e8f8'; c.lineWidth = 0.9;
          for (const k of [-1, 0, 1]) { c.beginPath(); c.moveTo(5, sd * 4.5 + k * 0.8); c.lineTo(12, sd * 4.5 + k * 1.4); c.stroke(); }
        }
        break;
      case 'hammer':
        c.fillStyle = trimFill(c, T, -1, -10, 7, -5); rr(c, -1, -10.5, 8, 5.5, 1.5); c.fill();
        c.strokeStyle = '#3a2a1a'; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(0, 4); c.lineTo(13, 4); c.stroke();
        steel(c, 11, 0.5, 5.5, 7, '#7a8088');
        c.strokeStyle = 'rgba(140,210,255,0.8)'; c.lineWidth = 0.8; c.strokeRect(11, 0.5, 5.5, 7);
        break;
      case 'shotgun':
        steel(c, 0.5, 1.8, 11, 2.4);
        c.fillStyle = linFill(c, 0, 1.8, 0, 4.2, '#6a4628'); c.fillRect(0.5, 1.8, 4, 2.4);
        break;
      case 'sniper':
        steel(c, -1, 2, 18, 1.6);
        steel(c, 4, 0.8, 5, 1.4, '#5a5c62');
        c.fillStyle = linFill(c, 0, 2, 0, 3.6, '#5a3c22'); c.fillRect(-1, 2, 5, 1.6);
        break;
      case 'staff':
        c.strokeStyle = goldFill(c, -5, 3, 14, 5); c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(-5, 4.5); c.lineTo(14, 3.5); c.stroke();
        dot(c, 14.5, 3.5, 2.2, '#9fe4ff'); dot(c, 14, 3, 0.8, '#fff');
        break;
      case 'crozius':
        steel(c, 1, -4.8, 6, 2);
        c.strokeStyle = '#2a1a10'; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(-1, 4); c.lineTo(11, 4); c.stroke();
        c.fillStyle = goldFill(c, 10, 0, 15, 8);
        c.beginPath(); c.moveTo(10, 4); c.lineTo(15, -0.5); c.lineTo(13, 4); c.lineTo(15, 8.5); c.closePath(); c.fill();
        dot(c, 12.2, 4, 1.2, '#efe8d8');
        break;
    }
  }

  function marineArt(c, m) {
    const ch = CHAPTERS[chapter];
    const A = m.armour || ch.armour, T = m.trim || ch.trim;
    const D = shade(A, -50);
    if (!m.airborne) baseArt(c, 9.5);
    if (m.pack === 'jump') {
      c.fillStyle = linFill(c, 0, -6.5, 0, 6.5, D, 40, -30); rr(c, -12.5, -6.5, 8.5, 13, 3); c.fill();
      for (const sd of [-1, 1]) {
        c.fillStyle = domeFill(c, -12.5, sd * 4, 2.8, '#3c3c40'); c.beginPath(); c.arc(-12.5, sd * 4, 2.8, 0, TAU); c.fill();
        dot(c, -12.8, sd * 4, 1.4, '#0c0c0e');
      }
      c.fillStyle = trimFill(c, T, -11, -1, -6, 1); c.fillRect(-11, -0.9, 5, 1.8);
    } else {
      c.fillStyle = linFill(c, 0, -5.5, 0, 5.5, D, 40, -30); rr(c, -10.5, -5.5, 7, 11, 2.5); c.fill();
      for (const sd of [-1, 1]) { c.fillStyle = linFill(c, -11.5, 0, -8.5, 0, '#4a4a4e', 40, -40); c.fillRect(-11.6, sd * 3.2 - 1.3, 2.6, 2.6); dot(c, -11.6, sd * 3.2, 0.7, '#0c0c0e'); }
    }
    // right arm reaching for the weapon
    c.fillStyle = domeFill(c, 2, 4.5, 3, A); rr(c, -0.5, 3, 5, 3.4, 1.5); c.fill();
    // torso
    c.fillStyle = domeFill(c, -1, 0, 7, A); rr(c, -6.8, -5.4, 11, 10.8, 4); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 0.6; c.stroke();
    // gilded aquila on the chest
    c.strokeStyle = trimFill(c, T, 1, -3, 4, 3); c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(3.4, -3); c.lineTo(2, 0); c.lineTo(3.4, 3); c.stroke();
    // pauldrons with trim, chapter mark and a purity seal
    for (const sd of [-1, 1]) {
      c.fillStyle = domeFill(c, -0.5, sd * 6.4, 4.5, A);
      c.beginPath(); c.ellipse(-0.5, sd * 6.4, 4.6, 4, 0, 0, TAU); c.fill();
      c.strokeStyle = trimFill(c, T, -5, sd * 6.4 - 4, 4, sd * 6.4 + 4); c.lineWidth = 1.3; c.stroke();
    }
    const mark = m.armour ? T : ch.mark;
    c.strokeStyle = mark; c.lineWidth = 0.9;
    c.beginPath(); c.arc(-0.5, -6.4, 1.6, Math.PI * 0.15, Math.PI * 0.85, true); c.stroke();
    c.beginPath(); c.moveTo(-0.5, -8); c.lineTo(-0.5, -5.2); c.stroke();
    dot(c, 0.8, 7.6, 1.3, '#9c1c1c'); dot(c, 0.5, 7.3, 0.4, 'rgba(255,255,255,0.5)');
    c.fillStyle = '#e8dcc0'; c.fillRect(1.1, 8.3, 3.4, 0.9);
    weaponArt(c, m.weapon, T);
    // head
    if (m.head === 'skull') {
      c.fillStyle = domeFill(c, 1.5, 0, 3.5, '#e9e4d6'); c.beginPath(); c.arc(1.5, 0, 3.5, 0, TAU); c.fill();
      dot(c, 3.2, -1.2, 0.85, '#0c0a0a'); dot(c, 3.2, 1.2, 0.85, '#0c0a0a');
      c.fillStyle = '#0c0a0a'; c.fillRect(4.2, -0.8, 0.6, 1.6);
    } else {
      const hc = m.head === 'vet' ? (T === '#d4af37' ? '#c9a24a' : T) : A;
      c.fillStyle = domeFill(c, 1.4, 0, 3.4, hc); c.beginPath(); c.arc(1.4, 0, 3.4, 0, TAU); c.fill();
      c.fillStyle = '#16161a'; rr(c, 3.4, -1.6, 1.8, 3.2, 0.6); c.fill();
      for (const sd of [-1, 1]) { dot(c, 3.8, sd * 1.5, 0.85, '#ff3420'); dot(c, 3.6, sd * 1.5 - 0.3, 0.3, '#ffd0c0'); }
    }
    if (m.pack === 'psy') {
      c.strokeStyle = goldFill(c, -5, -5, 5, 5); c.lineWidth = 1.9;
      c.beginPath(); c.arc(0.8, 0, 4.9, Math.PI * 0.58, Math.PI * 1.42); c.stroke();
      for (const k of [-0.5, 0, 0.5]) dot(c, 0.8 + Math.cos(Math.PI + k) * 4.9, Math.sin(Math.PI + k) * 4.9, 1, '#8fe0ff');
    }
  }

  function scoutArt(c, m) {
    const ch = CHAPTERS[chapter];
    baseArt(c, 8.5);
    if (m.cloak) {
      c.fillStyle = linFill(c, -9, -7, 3, 7, '#56603e', 25, -35);
      c.beginPath(); c.ellipse(-3, 0, 7, 7.5, 0, 0, TAU); c.fill();
      for (const [a, b] of [[-5, -3], [-2, 4], [-6, 3], [-1, -5], [-7, 0]]) blob(c, a, b, 1.6, 1, '#323a22');
    }
    for (const sd of [-1, 1]) { c.fillStyle = domeFill(c, -0.5, sd * 5, 2.9, '#5e6050'); c.beginPath(); c.arc(-0.5, sd * 5, 2.9, 0, TAU); c.fill(); }
    c.fillStyle = domeFill(c, -0.5, 0, 5, ch.armour); rr(c, -4.6, -4, 8.2, 8, 2.5); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 0.6; c.stroke();
    weaponArt(c, m.weapon, ch.trim);
    c.fillStyle = domeFill(c, 1.2, 0, 2.7, '#d6a882'); c.beginPath(); c.arc(1.2, 0, 2.7, 0, TAU); c.fill();
    c.fillStyle = '#2a1c12'; c.beginPath(); c.arc(0.6, 0, 2.7, Math.PI * 0.5, Math.PI * 1.5); c.fill();
  }

  function marineSprite(m) {
    const key = ['m', chapter, m.kind || '', m.weapon, m.pack || '', m.head || '', m.armour || '', m.trim || '', m.cloak ? 1 : 0, m.airborne ? 1 : 0].join('|');
    return cached(key, 22, (c) => (m.kind === 'scout' ? scoutArt(c, m) : marineArt(c, m)), { shadeR: 12, outline: 0.7 });
  }

  function dreadArt(c, t) {
    const ch = CHAPTERS[chapter], A = ch.armour, T = ch.trim, D = shade(A, -50);
    const fire = t.path === 0, melee = t.path === 1;
    // oval base
    c.fillStyle = linFill(c, -20, -18, 20, 18, '#2c2824', 30, -30);
    c.beginPath(); c.ellipse(0, 0, 20, 18, 0, 0, TAU); c.fill();
    c.fillStyle = '#3c352d'; c.beginPath(); c.ellipse(0, 0, 17.5, 15.5, 0, 0, TAU); c.fill();
    // feet
    steel(c, -6, -13.5, 11, 5.5, '#2e2e32'); steel(c, -6, 8, 11, 5.5, '#2e2e32');
    // exhaust stacks
    for (const sd of [-1, 1]) { c.fillStyle = domeFill(c, -13, sd * 4, 2.8, '#46464a'); c.beginPath(); c.arc(-13, sd * 4, 2.8, 0, TAU); c.fill(); dot(c, -13, sd * 4, 1.3, '#0a0a0c'); }
    // hull
    c.fillStyle = domeFill(c, -2, 0, 12, A); rr(c, -11.5, -9.5, 19, 19, 4.5); c.fill();
    c.strokeStyle = trimFill(c, T, -11, -9, 7, 9); c.lineWidth = 1; rr(c, -9.5, -7.5, 15, 15, 3); c.stroke();
    // sarcophagus
    c.fillStyle = trimFill(c, T, 3, -5, 8, 5); rr(c, 3, -5.5, 5.5, 11, 1.5); c.fill();
    c.fillStyle = '#e8dcc0'; c.fillRect(4.2, -3.5, 3, 7);
    c.strokeStyle = '#7a1414'; c.lineWidth = 0.6; for (let k = -2.5; k < 3.5; k += 1.2) { c.beginPath(); c.moveTo(4.5, k); c.lineTo(6.8, k); c.stroke(); }
    c.fillStyle = domeFill(c, 8, 0, 3.5, A); rr(c, 6.5, -3, 4.5, 6, 1.5); c.fill();
    for (const sd of [-1, 1]) dot(c, 10.4, sd * 1.3, 0.8, '#ff3420');
    // left arm: fist
    c.fillStyle = domeFill(c, -1, -11, 5.5, A); c.beginPath(); c.ellipse(-1, -11, 5.8, 4.8, 0, 0, TAU); c.fill();
    c.strokeStyle = trimFill(c, T, -6, -15, 4, -7); c.lineWidth = 1; c.stroke();
    steel(c, 0, -14, 11, 6, '#36363a');
    c.fillStyle = domeFill(c, 13, -11, 5, A); rr(c, 10, -15.5, 7, 9, 2); c.fill();
    for (let k = 0; k < 4; k++) { c.fillStyle = trimFill(c, T, 16, 0, 18, 1); c.fillRect(16.5, -15 + k * 2.2, 2.2, 1.5); }
    if (melee && t.lv >= 2) steel(c, 3, -9, 10, 2.6, '#3a3a30');
    if (melee && t.lv >= 3) { c.strokeStyle = 'rgba(140,210,255,0.9)'; c.lineWidth = 1; rr(c, 10, -15.5, 7, 9, 2); c.stroke(); }
    // right arm: gatling or macro plasma
    c.fillStyle = domeFill(c, -1, 11, 5.5, A); c.beginPath(); c.ellipse(-1, 11, 5.8, 4.8, 0, 0, TAU); c.fill();
    c.strokeStyle = trimFill(c, T, -6, 7, 4, 15); c.lineWidth = 1; c.stroke();
    if (fire && t.lv >= 3) {
      steel(c, 0, 8, 22, 6.5, '#2a2e36');
      for (let k = 0; k < 4; k++) { c.fillStyle = '#6fd6ff'; rr(c, 4 + k * 4, 7.4, 1.8, 7.7, 0.6); c.fill(); }
    } else {
      steel(c, 0, 8, 16, 6, '#2a2a2e');
      for (let k = 0; k < 4; k++) steel(c, 15, 8.5 + k * 1.5, 6, 1.1, '#5a5a60');
    }
    if (fire && t.lv >= 2) {
      steel(c, -9, -20, 9, 5.5, '#3a4232');
      for (let k = 0; k < 3; k++) dot(c, -7.5 + k * 3, -17.2, 1, '#b01c1c');
    }
  }
  function dreadSprite(t) {
    const v = `${t.path}|${t.path === 0 ? Math.min(t.lv, 3) : t.path === 1 ? Math.min(t.lv, 3) : 0}`;
    return cached(`dread|${chapter}|${v}`, 26, (c) => dreadArt(c, t), { shadeR: 18, outline: 0.8 });
  }
  function whirlHull() {
    return cached(`whull|${chapter}`, 24, (c) => {
      const ch = CHAPTERS[chapter], A = ch.armour, T = ch.trim;
      steel(c, -20, -15, 40, 7.5, '#1c1c1e'); steel(c, -20, 7.5, 40, 7.5, '#1c1c1e');
      c.strokeStyle = '#34343a'; c.lineWidth = 1;
      for (let k = -18; k < 20; k += 2.6) { c.beginPath(); c.moveTo(k, -15); c.lineTo(k, -7.5); c.moveTo(k, 7.5); c.lineTo(k, 15); c.stroke(); }
      c.fillStyle = linFill(c, 0, -9, 0, 9, A, 50, -40); rr(c, -18, -9, 36, 18, 3.5); c.fill();
      c.strokeStyle = trimFill(c, T, -18, -9, 18, 9); c.lineWidth = 1.1; c.stroke();
      c.fillStyle = shade(A, -40); rr(c, 13, -8, 5, 16, 2); c.fill();
      c.fillStyle = linFill(c, 0, -6.5, 0, 6.5, A, 70, -10); rr(c, -15, -6.5, 13, 13, 2); c.fill();
      for (const sd of [-1, 1]) { dot(c, -17, sd * 5.5, 1.6, '#232326'); }
      // headlamps and a hull aquila
      dot(c, 17, -6, 1, '#ffe9a8'); dot(c, 17, 6, 1, '#ffe9a8');
      c.strokeStyle = trimFill(c, T, 6, -3, 11, 3); c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(6, -3.5); c.lineTo(9, 0); c.lineTo(6, 3.5); c.stroke();
    }, { shadeR: 20, outline: 0.8 });
  }
  function whirlTurret(burn) {
    return cached(`wtur|${chapter}|${burn ? 1 : 0}`, 10, (c) => {
      const T = CHAPTERS[chapter].trim;
      c.fillStyle = linFill(c, 0, -7, 0, 7, '#353a30', 45, -35); rr(c, -6.5, -7, 14, 14, 2); c.fill();
      c.strokeStyle = trimFill(c, T, -6, -7, 7, 7); c.lineWidth = 1; c.stroke();
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { dot(c, -1.5 + j * 5, -4.2 + i * 4.2, 1.7, '#0c0c0e'); dot(c, -1.5 + j * 5, -4.2 + i * 4.2, 1, burn ? '#ff7a1a' : '#b01c1c'); }
    }, { shadeR: 8, outline: 0.8 });
  }

  const flashes = []; // muzzle flashes found while drawing towers, lit in the glow pass

  function drawTower(c, t, x, y, scale) {
    const s = (scale || 1) * MODEL_SCALE;
    if (t.type === 'dreadnought') {
      const p = (t.punch || 0) * 0.35;
      const ca = Math.cos(t.angle), sa = Math.sin(t.angle);
      stamp(c, dreadSprite(t), x + ca * p, y + sa * p, t.angle, s * 0.9, 0.55);
      if (t.flash > 3) flashes.push({ x: x + (ca * 22 - sa * 11) * s * 0.9, y: y + (sa * 22 + ca * 11) * s * 0.9, big: true });
      return;
    }
    if (t.type === 'whirlwind') {
      stamp(c, whirlHull(), x, y, 0, s * 0.85, 0.55);
      stamp(c, whirlTurret(t.path === 1), x - 2, y, t.angle, s * 0.85, 0.35);
      return;
    }
    const def = TOWERS[t.type];
    const models = def.look(t);
    const off = t.leap ? leapOffset(t) : null;
    const ca = Math.cos(t.angle), sa = Math.sin(t.angle);
    models.forEach((m, i) => {
      const [fx, fy] = def.formation[i] || [0, 0];
      const mx = x + fx * s, my = y + fy * s;
      const ms = (m.scale || 1) * s;
      if (off) {
        const spr = marineSprite(Object.assign({}, m, { airborne: true }));
        const gx = mx + off.dx, gy = my + off.dy;
        c.globalAlpha = 0.4 * (1 - off.h * 0.5);
        const sz = spr.half * 2 * ms;
        c.save(); c.translate(gx + 3, gy + 4); c.rotate(t.angle); c.drawImage(spr.shadow, -sz / 2, -sz / 2, sz, sz); c.restore();
        c.globalAlpha = 1;
        const ay = gy - off.h * 16, k = ms * (1 + off.h * 0.3);
        flashes.push({ x: gx - ca * 14 * k, y: ay - sa * 14 * k, jet: true, a: 0.5 + off.h * 0.5 });
        stamp(c, spr, gx, ay, t.angle, k, 0);
        return;
      }
      stamp(c, marineSprite(m), mx, my, t.angle, ms, 0.55);
      const fired = i === (t.shot - 1 + models.length) % models.length;
      const mz = MUZZLE[m.weapon];
      if (fired && t.flash > 3 && mz) flashes.push({ x: mx + (mz[0] * ca - mz[1] * sa) * ms, y: my + (mz[0] * sa + mz[1] * ca) * ms, weapon: m.weapon });
    });
  }

  function drawPool(c) {
    const x = 8, y = 90, t = state.time * 0.04;
    const pulse = 1 + Math.sin(t * 2) * 0.04;
    const g = c.createRadialGradient(x, y, 4, x, y, 64 * pulse);
    g.addColorStop(0, '#ffc0dc'); g.addColorStop(0.3, '#c0487e'); g.addColorStop(0.7, '#4b1460'); g.addColorStop(1, 'rgba(40,10,40,0)');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(x, y, 54 * pulse, 62 * pulse, 0, 0, TAU); c.fill();
    // ripples on the biomass
    c.strokeStyle = 'rgba(255,200,230,0.25)'; c.lineWidth = 1.2;
    for (let k = 0; k < 3; k++) {
      const ph = ((t * 0.5 + k / 3) % 1);
      c.globalAlpha = 1 - ph;
      c.beginPath(); c.ellipse(x + 6, y, 8 + ph * 40, 9 + ph * 46, 0, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;
    c.lineCap = 'round';
    for (let k = 0; k < 8; k++) {
      const a = -1.35 + k * 0.38, sw = Math.sin(t * 3 + k) * 0.25;
      const x0 = x + Math.cos(a) * 30, y0 = y + Math.sin(a) * 34;
      const x2 = x + Math.cos(a - sw) * 70, y2 = y + Math.sin(a - sw) * 74;
      for (const [col, w] of [['#1e0a1e', 5 - (k % 3)], ['#7a3466', 3 - (k % 3) * 0.7]]) {
        c.strokeStyle = col; c.lineWidth = w;
        c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x + Math.cos(a + sw) * 54, y + Math.sin(a + sw) * 60, x2, y2); c.stroke();
      }
      dot(c, x2, y2, 1.6, '#f0a0d0');
    }
    for (let k = 0; k < 6; k++) {
      const ph = (t * 0.8 + k * 0.19) % 1;
      const bx = x + 4 + Math.sin(k * 7) * 16, by = y + Math.cos(k * 5) * 24;
      c.globalAlpha = 1 - ph;
      c.strokeStyle = 'rgba(255,220,240,0.7)'; c.lineWidth = 0.8;
      c.beginPath(); c.arc(bx, by, 1.5 + ph * 4, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;
    light(x + 10, y, 150 * pulse, '255,90,180', 0.9);
    light(0, 340, 110, '190,110,230', 0.6);
  }

  function drawFire(c, f, glowPass) {
    const t = state.time * 0.25 + f.x;
    const s = f.s;
    if (glowPass) {
      glow(c, f.x, f.y - 4 * s, 26 * s + Math.sin(t * 1.7) * 3, '255,140,40', 0.55);
      glow(c, f.x, f.y - 6 * s, 10 * s, '255,230,160', 0.6);
      return;
    }
    if (f.brazier) {
      c.fillStyle = linFill(c, 0, f.y - 3, 0, f.y + 4, '#3a3530', 40, -30);
      c.beginPath(); c.ellipse(f.x, f.y, 6, 3.5, 0, 0, TAU); c.fill();
    }
    for (let k = 0; k < 5; k++) {
      const ph = t * (1 + k * 0.13) + k * 2;
      const fx = f.x + Math.sin(ph) * 3 * s + (k - 2) * 2 * s;
      const h = (9 + Math.sin(ph * 1.7) * 3) * s * (k === 2 ? 1.4 : 1);
      for (const [col, k] of [['rgba(255,80,20,0.85)', 1], ['rgba(255,180,50,0.85)', 0.65], ['rgba(255,245,200,0.9)', 0.35]]) {
        c.fillStyle = col;
        c.beginPath(); c.moveTo(fx - 3 * s * k, f.y); c.quadraticCurveTo(fx - 2 * s * k, f.y - h * 0.6 * k, fx + Math.sin(ph * 2) * 2 * k, f.y - h * k); c.quadraticCurveTo(fx + 2 * s * k, f.y - h * 0.6 * k, fx + 3 * s * k, f.y); c.fill();
      }
    }
    light(f.x, f.y, 90 * s + Math.sin(t * 1.3) * 8, '255,150,60', 0.75);
    if (Math.random() < 0.08 * s && state.particles.length < 900) state.particles.push({ x: f.x + rand(-3, 3), y: f.y - 8, vx: rand(-0.2, 0.4), vy: rand(-0.9, -0.4), life: 50, max: 50, color: '#ffb050', size: 1.4, ember: true });
    if (Math.random() < 0.05 * s && state.particles.length < 900) state.particles.push({ x: f.x, y: f.y - 12 * s, vx: rand(0.1, 0.4), vy: rand(-0.6, -0.3), life: 90, max: 90, size: 5, grow: 0.12, smoke: true });
  }

  function render() {
    const c = ctx;
    flashes.length = 0;
    state.shake = (state.shake || 0) * 0.86;
    const sh = state.shake > 0.25 ? state.shake : 0;
    c.save();
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    if (sh) c.translate(rand(-sh, sh), rand(-sh, sh));
    c.drawImage(bg, 0, 0, W, H);

    // ground decals
    for (const d of state.decals) {
      c.globalAlpha = Math.min(0.85, d.life / 300);
      if (d.scorch) c.drawImage(scorchSprite().cv, d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
      else stamp(c, splatSprite(d.color, d.v || 0), d.x, d.y, d.rot, d.r / 12, 0);
    }
    c.globalAlpha = 1;
    for (const z of state.zones) {
      const k = z.life / z.max;
      c.globalAlpha = 0.5 * k;
      c.drawImage(scorchSprite().cv, z.x - z.r, z.y - z.r, z.r * 2, z.r * 2);
      c.globalAlpha = 1;
      light(z.x, z.y, z.r * 2.2, '255,120,40', 0.7 * k);
      if (Math.random() < 0.4) state.particles.push({ x: z.x + rand(-z.r, z.r) * 0.6, y: z.y + rand(-z.r, z.r) * 0.6, vx: 0, vy: -0.6, life: 18, max: 18, color: '#ff8a2a', size: 4, flame: true });
    }
    drawPool(c);

    // the swarm on the ground: all shadows first, then bodies from back to front
    const ground = state.enemies.filter((e) => !e.u.fly).sort((a, b) => a.y - b.y);
    for (const e of ground) {
      const spr = unitFrame(e);
      const s = spr.half * 2;
      c.globalAlpha = e.u.camo ? 0.2 : 0.5;
      c.save(); c.translate(e.x + SHADOW.dx, e.y + SHADOW.dy); c.rotate(e.facing); c.drawImage(spr.shadow, -s / 2, -s / 2, s, s); c.restore();
    }
    c.globalAlpha = 1;
    for (const e of ground) {
      const bob = e.u.key === 'zoanthrope' ? Math.sin(state.time * 0.4 + e.phase) * 2 - 4 : 0;
      c.globalAlpha = e.u.camo ? 0.42 + 0.1 * Math.sin(state.time * 0.1 + e.phase) : 1;
      stamp(c, unitFrame(e), e.x, e.y + bob, e.facing, 1, 0);
      if (e.u.key === 'zoanthrope') light(e.x, e.y, 60, '120,255,140', 0.5);
    }
    c.globalAlpha = 1;

    for (const t of state.towers.slice().sort((a, b) => a.y - b.y)) if (!t.leap) drawTower(c, t, t.x, t.y);

    for (const f of TERRAIN.fires) drawFire(c, f, false);

    // fliers soar above everything else
    const air = state.enemies.filter((e) => e.u.fly);
    for (const e of air) {
      const spr = unitFrame(e);
      const s = spr.half * 2;
      c.globalAlpha = 0.28;
      c.save(); c.translate(e.x + 12, e.y + 20); c.rotate(e.facing); c.drawImage(spr.shadow, -s / 2, -s / 2, s, s); c.restore();
    }
    c.globalAlpha = 1;
    for (const e of air) stamp(c, unitFrame(e), e.x, e.y, e.facing, 1, 0);
    for (const t of state.towers) if (t.leap) drawTower(c, t, t.x, t.y);

    // projectile bodies
    for (const p of state.projectiles) {
      if (p.style === 'missile') {
        c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(p.vy, p.vx));
        steel(c, -4.5, -1.4, 8, 2.8, '#454a3c');
        dot(c, 3.6, 0, 1.4, '#b01c1c');
        c.fillStyle = '#2a2a2a'; c.fillRect(-4.5, -2.4, 2, 4.8);
        c.restore();
        light(p.x, p.y, 40, '255,150,60', 0.5);
      } else if (p.style === 'plasma') {
        light(p.x, p.y, 60, '90,190,255', 0.7);
      }
    }
    for (const sh2 of state.shells) {
      if (sh2.t < 0) continue;
      const k = sh2.t / sh2.dur;
      const gx = sh2.sx + (sh2.tx - sh2.sx) * k, gy = sh2.sy + (sh2.ty - sh2.sy) * k;
      const hgt = Math.sin(k * Math.PI) * 90;
      blob(c, gx + hgt * 0.15, gy + hgt * 0.1, 3, 1.6, 'rgba(0,0,0,0.3)');
      const dy = (sh2.ty - sh2.sy) - Math.cos(k * Math.PI) * 90 * Math.PI;
      c.save(); c.translate(gx, gy - hgt); c.rotate(Math.atan2(dy, sh2.tx - sh2.sx)); c.scale(1 + hgt / 150, 1 + hgt / 150);
      steel(c, -5, -1.7, 9, 3.4, '#454a3c');
      dot(c, 4, 0, 1.7, sh2.w.burn ? '#ff7a1a' : '#b01c1c');
      c.restore();
      light(gx, gy - hgt, 36, '255,150,60', 0.5);
      if (state.time % 2 === 0 && state.particles.length < 900) state.particles.push({ x: gx, y: gy - hgt, vx: rand(-0.2, 0.2), vy: rand(-0.2, 0.2), life: 30, max: 30, size: 3, grow: 0.15, smoke: true });
    }

    // normal-blend effects and particles
    for (const f of state.fx) {
      const k = f.life / f.max;
      if (f.type === 'ring') {
        c.globalAlpha = k * 0.8;
        c.strokeStyle = '#e8dcc0'; c.lineWidth = 3 * k;
        c.beginPath(); c.arc(f.x, f.y, f.r * (1.3 - k * 0.6), 0, TAU); c.stroke();
      } else if (f.type === 'vortex') {
        c.globalAlpha = k;
        blob(c, f.x, f.y, f.r * 0.45, f.r * 0.45, 'rgba(10,0,20,0.85)');
        light(f.x, f.y, f.r * 3, '170,90,255', k);
      } else if (f.type === 'boom') {
        light(f.x, f.y, f.r * 4, f.color === 'plasma' ? '110,200,255' : '255,160,60', k * 1.2);
      } else if (f.type === 'arc') {
        for (const [x, y] of f.pts) light(x, y, 50, '120,150,255', k * 0.8);
      }
    }
    c.globalAlpha = 1;
    for (const p of state.particles) {
      const k = clamp(p.life / p.max, 0, 1);
      if (p.flame || p.ember || p.spark) continue;
      if (p.smoke) {
        c.globalAlpha = k * 0.55;
        c.drawImage(smokeSprite().cv, p.x - p.size * 1.5, p.y - p.size * 1.5, p.size * 3, p.size * 3);
      } else {
        c.globalAlpha = Math.min(1, k * 1.4);
        dot(c, p.x, p.y, p.size * 0.6, p.color);
      }
    }
    c.globalAlpha = 1;

    for (const f of flashes) light(f.x, f.y, f.big ? 70 : f.jet ? 40 : 50, f.weapon === 'plasma' ? '100,200,255' : '255,190,90', f.jet ? 0.5 : 0.9);
    for (const t of state.towers) if (t.type === 'librarian' && t.flash > 0) light(t.x, t.y, 70, '120,170,255', 0.8);

    applyLights(c);

    // additive glow pass
    c.globalCompositeOperation = 'lighter';
    for (const f of TERRAIN.fires) drawFire(c, f, true);
    glow(c, 10, 90, 70 + Math.sin(state.time * 0.08) * 6, '255,80,170', 0.35);
    // synapse threads
    c.strokeStyle = 'rgba(200,120,255,0.35)'; c.lineWidth = 1; c.globalAlpha = 1;
    for (const s of state.enemies) {
      if (!s.u.synapse || s.nulled) continue;
      let n = 0;
      c.beginPath();
      for (const e of state.enemies) {
        if (n > 7) break;
        if (e === s || !e.synapsed || Math.abs(e.x - s.x) > 90 || Math.abs(e.y - s.y) > 90) continue;
        c.moveTo(s.x, s.y); c.quadraticCurveTo((s.x + e.x) / 2 + Math.sin(state.time * 0.1 + n) * 6, (s.y + e.y) / 2, e.x, e.y);
        n++;
      }
      c.stroke();
      glow(c, s.x, s.y, 22, '200,120,255', 0.35);
    }
    for (const e of state.enemies) {
      if (e.flash > 0) glow(c, e.x, e.y, e.u.r * 1.6, '255,240,220', 0.35);
      if (e.u.key === 'zoanthrope') glow(c, e.x, e.y - 3, 26, '120,255,140', 0.28 + Math.sin(state.time * 0.15 + e.phase) * 0.08);
    }
    for (const p of state.projectiles) {
      if (p.style === 'plasma') {
        glow(c, p.x, p.y, 16, '80,180,255', 0.9); glow(c, p.x, p.y, 5, '230,250,255', 1);
      } else if (p.style === 'missile') {
        const a = Math.atan2(p.vy, p.vx);
        glow(c, p.x - Math.cos(a) * 6, p.y - Math.sin(a) * 6, 9, '255,160,60', 0.9);
      } else {
        const col = p.style === 'pellet' ? '255,230,170' : '255,190,80';
        c.globalAlpha = 0.9;
        c.strokeStyle = `rgba(${col},0.9)`; c.lineWidth = p.style === 'hbolt' ? 2.6 : 1.8;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 1.4, p.y - p.vy * 1.4); c.stroke();
        glow(c, p.x, p.y, p.style === 'hbolt' ? 9 : 6, col, 0.7);
      }
    }
    for (const sh2 of state.shells) {
      if (sh2.t < 0) continue;
      const k = sh2.t / sh2.dur;
      glow(c, sh2.sx + (sh2.tx - sh2.sx) * k, sh2.sy + (sh2.ty - sh2.sy) * k - Math.sin(k * Math.PI) * 90, 10, '255,160,60', 0.8);
    }
    for (const f of flashes) {
      if (f.jet) { glow(c, f.x, f.y, 10, '255,170,60', f.a); continue; }
      const col = f.weapon === 'plasma' || f.weapon === 'staff' ? '120,210,255' : f.weapon === 'flamer' ? '255,120,30' : '255,200,110';
      glow(c, f.x, f.y, f.big ? 16 : 11, col, 0.95); glow(c, f.x, f.y, 4, '255,255,230', 1);
    }
    for (const f of state.fx) {
      const k = f.life / f.max;
      if (f.type === 'tracer') {
        c.globalAlpha = k; c.strokeStyle = 'rgba(255,240,190,0.95)'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(f.x1, f.y1); c.lineTo(f.x2, f.y2); c.stroke();
      } else if (f.type === 'boom') {
        const plasma = f.color === 'plasma';
        const r = f.r * (1.25 - k * 0.45);
        glow(c, f.x, f.y, r * 1.6, plasma ? '80,170,255' : '255,120,30', k);
        glow(c, f.x, f.y, r * 0.8, plasma ? '210,245,255' : '255,220,140', k);
      } else if (f.type === 'vortex') {
        c.save(); c.translate(f.x, f.y); c.rotate(state.time * 0.25);
        c.globalAlpha = k;
        for (let i = 0; i < 4; i++) {
          c.strokeStyle = i % 2 ? 'rgba(190,100,255,0.9)' : 'rgba(110,210,255,0.9)'; c.lineWidth = 3;
          c.beginPath(); c.arc(0, 0, f.r * (0.35 + i * 0.2), i, i + Math.PI * 1.2); c.stroke();
        }
        c.restore();
        glow(c, f.x, f.y, f.r * 1.4, '170,90,255', k * 0.8);
      } else if (f.type === 'arc') {
        const rng = mulberry32(Math.floor(state.time / 3) + f.pts.length);
        const path = [];
        f.pts.forEach(([x, y], i) => {
          if (!i) { path.push([x, y]); return; }
          const [px, py] = f.pts[i - 1];
          for (let s = 1; s <= 4; s++) path.push([px + ((x - px) * s) / 5 + (rng() - 0.5) * 14, py + ((y - py) * s) / 5 + (rng() - 0.5) * 14]);
          path.push([x, y]);
        });
        c.globalAlpha = k;
        for (const [col, w] of [['rgba(90,120,255,0.35)', 9], ['rgba(140,170,255,0.8)', 3.5], ['rgba(240,248,255,1)', 1.3]]) {
          c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round';
          c.beginPath(); path.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
        }
        for (const [x, y] of f.pts.slice(1)) glow(c, x, y, 14, '150,180,255', k);
      }
    }
    for (const p of state.particles) {
      const k = clamp(p.life / p.max, 0, 1);
      if (p.flame) glow(c, p.x, p.y, p.size * (2.2 - k), k > 0.5 ? '255,170,60' : '255,90,20', k * 0.8);
      else if (p.ember) glow(c, p.x, p.y, 3, '255,160,60', k);
      else if (p.spark) {
        c.globalAlpha = k; c.strokeStyle = 'rgba(255,220,140,1)'; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 2, p.y - p.vy * 2); c.stroke();
      }
    }
    // drifting spores glow faintly
    for (const a of ash) if (a.spore) glow(c, a.x, a.y, 4 + a.s, '220,120,255', 0.35);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;

    // atmosphere
    if (!lowQuality) {
      const fx = (state.time * 0.12) % 960;
      c.globalAlpha = 0.13;
      c.drawImage(fogCv, -fx, -40, 960, 960);
      c.drawImage(fogCv, 960 - fx, -40, 960, 960);
      c.globalAlpha = 1;
    }
    for (const a of ash) {
      a.x += a.v * 0.6; a.y += a.v * 0.35 + Math.sin(state.time * 0.02 + a.s) * 0.1;
      if (a.x > W + 5) a.x = -5; if (a.y > H + 5) a.y = -5;
      if (!a.spore) { c.globalAlpha = 0.35; dot(c, a.x, a.y, a.s * 0.6, '#d8d0c4'); }
    }
    c.globalAlpha = 1;
    c.drawImage(vignetteCv, 0, 0, W, H);
    c.restore();

    // ---- interface layer (unlit)
    if (selected) {
      const s = selected.stats;
      const range = s.aura ? s.aura.radius : effW(selected, s.w[0]).range;
      c.save();
      const g = c.createRadialGradient(selected.x, selected.y, range * 0.6, selected.x, selected.y, range);
      g.addColorStop(0, 'rgba(201,162,74,0)'); g.addColorStop(1, s.aura ? 'rgba(200,50,40,0.18)' : 'rgba(201,162,74,0.16)');
      c.fillStyle = g;
      c.strokeStyle = 'rgba(230,195,110,0.75)'; c.lineWidth = 1.5; c.setLineDash([8, 6]); c.lineDashOffset = -state.time * 0.3;
      c.beginPath(); c.arc(selected.x, selected.y, range, 0, TAU); c.fill(); c.stroke();
      c.setLineDash([]);
      c.strokeStyle = '#e8c56a'; c.lineWidth = 2;
      c.beginPath(); c.arc(selected.x, selected.y, TOWERS[selected.type].r + 8, 0, TAU); c.stroke();
      c.restore();
    }
    for (const e of state.enemies) {
      const u = e.u;
      if (u.camo) {
        c.save();
        c.strokeStyle = 'rgba(160,220,120,0.55)'; c.lineWidth = 1.2; c.setLineDash([3, 4]);
        c.lineDashOffset = -state.time * 0.5;
        c.beginPath(); c.arc(e.x, e.y, u.r + 6, 0, TAU); c.stroke();
        c.restore();
      }
      if (e.slowT > 0) {
        c.strokeStyle = e.slowMul === 0 ? 'rgba(255,240,150,0.8)' : 'rgba(120,200,255,0.7)'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(e.x, e.y, u.r + 3, 0, TAU); c.stroke();
      }
      if (e.hp < e.maxHp && e.maxHp >= 15) {
        const bw = u.boss ? 90 : Math.max(20, u.r * 2.2), k = Math.max(0, e.hp / e.maxHp);
        const by = e.y - u.r * UNIT_SCALE - (u.boss ? 34 : 12);
        c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(e.x - bw / 2 - 1, by - 1, bw + 2, u.boss ? 8 : 5);
        c.fillStyle = u.boss ? '#a040d0' : '#c8402c'; c.fillRect(e.x - bw / 2, by, bw * k, u.boss ? 6 : 3);
        c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(e.x - bw / 2, by, bw * k, 1);
      }
    }

    if (placing && hover.inside) {
      const def = TOWERS[placing];
      const ok = canPlace(placing, hover.x, hover.y) && state.money >= def.cost;
      const range = def.base.aura ? def.base.aura.radius : def.base.w[0].range;
      c.save();
      c.fillStyle = ok ? 'rgba(143,220,132,0.10)' : 'rgba(255,80,60,0.14)';
      c.strokeStyle = ok ? 'rgba(143,220,132,0.75)' : 'rgba(255,80,60,0.75)';
      c.setLineDash([6, 6]); c.lineWidth = 1.5;
      c.beginPath(); c.arc(hover.x, hover.y, range, 0, TAU); c.fill(); c.stroke();
      c.restore();
      c.globalAlpha = 0.8;
      drawTower(c, ghostTower(placing), hover.x, hover.y);
      c.globalAlpha = 1;
    }

    c.textAlign = 'center';
    c.font = '700 13px "Alegreya Sans", sans-serif';
    for (const f of state.floats) {
      c.globalAlpha = Math.min(1, f.life / 20);
      c.fillStyle = '#000'; c.fillText(f.text, f.x + 1, f.y + 1);
      c.fillStyle = f.color; c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;

    if (state.paused) {
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#c9a24a'; c.font = '48px "Pirata One", serif';
      c.fillText('Paused', W / 2, H / 2);
    }
  }

  function ghostTower(type) {
    return { type, trunk: 0, path: -1, lv: 0, angle: -Math.PI / 2, flash: 0, punch: 0, leap: null, shot: 0 };
  }

  // ----------------------------------------------------------------------- UI
  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2200);
  }
  function showOverlay(title, text, buttons) {
    $('ovTitle').textContent = title;
    $('ovText').textContent = text;
    const box = $('ovButtons');
    box.innerHTML = '';
    for (const [label, fn] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = 'primary';
      b.addEventListener('click', fn);
      box.appendChild(b);
    }
    $('overlay').hidden = false;
  }
  function hideOverlay() { $('overlay').hidden = true; }

  const hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function updateHud(force) {
    if (force) for (const k in hudCache) delete hudCache[k];
    setText('faith', String(Math.max(0, Math.ceil(state.lives))));
    setText('money', String(Math.floor(state.money)));
    setText('wave', state.freeplay || state.wave >= FINAL_WAVE ? `${state.wave}` : `${state.wave} / ${FINAL_WAVE}`);
    $('faithBox').classList.toggle('low', state.lives < 30);
    const dis = state.waveActive || state.over || (state.won && !state.freeplay);
    if ($('startBtn').disabled !== dis) $('startBtn').disabled = dis;
    for (const b of document.querySelectorAll('.shop-btn')) {
      b.classList.toggle('poor', state.money < TOWERS[b.dataset.type].cost);
      b.classList.toggle('active', placing === b.dataset.type);
    }
  }

  function towerIcon(type, size) {
    const cv = document.createElement('canvas');
    cv.width = size * 2; cv.height = size * 2;
    const c = cv.getContext('2d');
    c.scale(2, 2);
    const scale = { whirlwind: 0.85, dreadnought: 0.9 }[type] || 1;
    drawTower(c, Object.assign(ghostTower(type), { angle: -0.6 }), size / 2, size / 2 + 1, (scale * size) / 44 / MODEL_SCALE);
    return cv;
  }
  function unitIcon(key) {
    const spr = unitSprite(key, 0);
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const c = cv.getContext('2d');
    const reach = { titan: 70, tyrant: 30, tervigon: 30, harpy: 30, carnifex: 27, gargoyle: 16 }[key] || UNIT_HALF[key] * 0.85;
    const size = spr.half * 2 * (30 / (reach * UNIT_SCALE));
    c.translate(32, 32); c.rotate(-Math.PI / 2);
    c.drawImage(spr.cv, -size / 2, -size / 2, size, size);
    return cv.toDataURL();
  }
  const UNIT_ICONS = {};

  function buildShop() {
    const shop = $('shop');
    shop.innerHTML = '';
    for (const key of TOWER_KEYS) {
      const def = TOWERS[key];
      const b = document.createElement('button');
      b.className = 'shop-btn';
      b.dataset.type = key;
      b.title = `${def.name}: ${def.blurb}`;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = def.short;
      const cost = document.createElement('span'); cost.className = 'cost'; cost.textContent = `⚙ ${def.cost}`;
      const hk = document.createElement('span'); hk.className = 'hk'; hk.textContent = def.key;
      b.append(towerIcon(key, 44), nm, cost, hk);
      b.addEventListener('click', () => { if (suppressClick) return; beginPlace(key); });
      b.addEventListener('pointerdown', (ev) => startDrag(ev, key, b));
      b.addEventListener('pointermove', moveDrag);
      b.addEventListener('pointerup', endDrag);
      b.addEventListener('pointercancel', cancelDrag);
      shop.appendChild(b);
    }
    updateHud(true);
  }

  // Drag and drop deployment: press a unit card, drag it onto the battlefield, release to deploy.
  // A press that never moves falls through to the click handler (pick, then click the ground).
  let drag = null;
  let suppressClick = false; // swallows the click the browser fires at the end of a drag
  const dragGhost = document.createElement('div');
  dragGhost.className = 'drag-ghost';
  dragGhost.hidden = true;
  document.body.appendChild(dragGhost);

  function startDrag(ev, key, b) {
    if (ev.button !== 0 || state.over) return;
    drag = { key, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, active: false };
    try { b.setPointerCapture(ev.pointerId); } catch (e) { /* capture is optional */ }
  }
  function moveDrag(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.active) {
      if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 6) return;
      ensureAudio();
      if (state.money < TOWERS[drag.key].cost) { toast('Not enough requisition.'); drag = null; return; }
      drag.active = true;
      placing = drag.key;
      selected = null;
      dragGhost.replaceChildren(towerIcon(drag.key, 44));
      renderPanel();
      updateHud();
    }
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const inside = ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
    const p = toBoard(ev);
    hover = { x: p.x, y: p.y, inside };
    // over the board the in-world preview takes over from the floating card
    dragGhost.hidden = inside;
    dragGhost.style.transform = `translate(${ev.clientX - 26}px, ${ev.clientY - 26}px)`;
  }
  function endDrag(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    dragGhost.hidden = true;
    if (!d.active) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const def = TOWERS[d.key];
    if (hover.inside) {
      if (state.money < def.cost) toast('Not enough requisition.');
      else if (!canPlace(d.key, hover.x, hover.y)) toast('Cannot deploy there.');
      else selected = placeTower(d.key, hover.x, hover.y);
    }
    placing = null;
    hover.inside = false;
    renderPanel();
    updateHud();
  }
  function cancelDrag() {
    if (!drag) return;
    drag = null;
    dragGhost.hidden = true;
    placing = null;
    renderPanel();
    updateHud();
  }

  function beginPlace(key) {
    ensureAudio();
    if (placing === key) { placing = null; renderPanel(); updateHud(); return; }
    if (state.money < TOWERS[key].cost) { toast('Not enough requisition.'); return; }
    placing = key;
    selected = null;
    renderPanel();
    updateHud();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

  function nodeButton(node, cls, id, hint) {
    return `<button class="node ${cls}" ${id ? `id="${id}"` : 'disabled'} title="${esc(hint || '')}">
      <span class="n-name">${esc(node.name)}</span><span class="n-desc">${esc(node.desc)}</span>
      <span class="n-cost">${cls.includes('owned') ? 'Owned' : `⚙ ${node.cost}`}</span></button>`;
  }

  function renderPanel() {
    const p = $('panel');
    if (selected) {
      const t = selected, def = TOWERS[t.type], s = t.stats;
      const w0 = s.w[0], ef = effW(t, w0);
      const rows = [];
      if (s.aura) {
        rows.push(['Aura radius', Math.round(s.aura.radius)]);
        rows.push(['Fire-rate bonus', `+${Math.round((1 / s.aura.rate - 1) * 100)}%`]);
        if (s.aura.dmg) rows.push(['Damage bonus', `+${s.aura.dmg}`]);
      }
      rows.push(['Range', Math.round(ef.range)]);
      rows.push(['Attacks / sec', (60 / ef.rate).toFixed(2)]);
      rows.push(['Damage', `${Math.round(ef.dmg)}${w0.count > 1 ? ` × ${w0.count}` : ''}`]);
      rows.push(['AP', ef.ap >= 9 ? 'Psychic' : ef.ap]);
      rows.push(['Kills', `<span id="pKills">${t.kills}</span>`]);
      const tags = [
        ['Weapons: ' + s.w.map((w) => w.label).join(', '), true],
        ['Hits fliers', s.w.some((w) => w.air)],
        ['Sees camouflage', seesCamo(t)],
      ];

      let tree = nodeButton(def.trunk, `trunk ${t.trunk ? 'owned' : ''}`, t.trunk ? '' : 'buyTrunk');
      tree += '<div class="branches">';
      def.paths.forEach((path, pi) => {
        tree += `<div class="branch"><h3>${esc(path.name)}</h3>`;
        path.nodes.forEach((node, ni) => {
          const owned = t.path === pi && ni < t.lv;
          const locked = t.path >= 0 && t.path !== pi;
          const isNext = !locked && t.trunk && ni === (t.path === pi ? t.lv : 0);
          const cls = owned ? 'owned' : locked ? 'locked' : isNext ? '' : 'future';
          const hint = locked ? 'Locked: the other doctrine was chosen.' : !t.trunk ? `Requires ${def.trunk.name}.` : '';
          tree += nodeButton(node, cls, isNext ? `buy${pi}` : '', hint);
        });
        tree += '</div>';
      });
      tree += '</div>';

      p.innerHTML = `
        <h2>${esc(def.name)}</h2>
        <p class="sub">${esc(def.blurb)}</p>
        <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        <div class="tags">${tags.map(([k, v]) => `<span class="tag${v ? ' yes' : ''}">${esc(k)}</span>`).join('')}</div>
        <div class="tree">${tree}</div>
        <p class="tree-note">Buy the shared upgrade, then pick a doctrine (<kbd>Z</kbd> / <kbd>X</kbd>). Choosing one locks the other.</p>
        <div class="row" style="margin-top:10px">
          <button id="modeBtn">Target: ${t.mode}<kbd>T</kbd></button>
          <button id="sellBtn">Sell ⚙ ${Math.floor(t.spent * 0.7)}<kbd>S</kbd></button>
        </div>`;
      const bt = $('buyTrunk'); if (bt) bt.addEventListener('click', () => buyAndRefresh('trunk'));
      for (const pi of [0, 1]) { const b = $(`buy${pi}`); if (b) b.addEventListener('click', () => buyAndRefresh(pi)); }
      $('modeBtn').addEventListener('click', cycleMode);
      $('sellBtn').addEventListener('click', sellSelected);
      refreshPanelLive();
      return;
    }
    if (placing) {
      const def = TOWERS[placing];
      p.innerHTML = `<h2>${esc(def.name)}</h2><p class="sub">${esc(def.blurb)}</p>
        <p>Drop it on open ground to deploy for <b>⚙ ${def.cost}</b>. Green means the ground is clear, red means blocked. You can also click the ground; hold Shift to deploy several. Esc cancels.</p>
        <p class="muted">Doctrines: ${def.paths.map((x) => esc(x.name)).join(' or ')}.</p>`;
      return;
    }
    const n = state.wave + 1;
    const counts = new Map();
    if (!(state.won && !state.freeplay)) for (const [key, count] of waveGroups(n)) counts.set(key, (counts.get(key) || 0) + count);
    const rank = (k) => (UNITS[k].boss ? 1e6 : UNITS[k].threat);
    const items = [...counts.entries()].sort((a, b) => rank(b[0]) - rank(a[0]));
    p.innerHTML = `<h2>Auspex</h2>
      <p class="sub">${state.waveActive ? `Wave ${n} in progress.` : `Wave ${n} incoming:`}</p>
      <ul class="augury">${items.map(([key, c]) => `<li><img alt="" src="${UNIT_ICONS[key]}">
        <span>${esc(UNITS[key].name)}<span class="note">${esc(UNITS[key].note)}</span></span>
        <span class="cnt">×${c}</span></li>`).join('')}</ul>`;
  }

  function refreshPanelLive() {
    if (!selected) return;
    const k = $('pKills');
    if (k) k.textContent = selected.kills;
    const bt = $('buyTrunk');
    if (bt) bt.disabled = state.money < TOWERS[selected.type].trunk.cost;
    for (const pi of [0, 1]) {
      const b = $(`buy${pi}`), node = nodeFor(selected, pi);
      if (b && node) b.disabled = state.money < node.cost;
    }
  }

  function buyAndRefresh(which) {
    if (!selected) return;
    if (buy(selected, which)) { renderPanel(); updateHud(); }
  }
  function sellSelected() {
    if (!selected) return;
    state.money += Math.floor(selected.spent * 0.7);
    state.towers = state.towers.filter((t) => t !== selected);
    burst(selected.x, selected.y, '#7a6a50', 14, 2.5);
    selected = null;
    renderPanel();
    updateHud();
  }
  function cycleMode() {
    if (!selected) return;
    selected.mode = TARGET_MODES[(TARGET_MODES.indexOf(selected.mode) + 1) % TARGET_MODES.length];
    renderPanel();
  }

  function restart() {
    state = newState();
    selected = null; placing = null;
    hideOverlay();
    $('speedBtn').firstChild.textContent = 'Speed 1×';
    $('autoBtn').textContent = 'Auto-wave: off';
    $('autoBtn').classList.remove('on');
    $('pauseBtn').firstChild.textContent = 'Pause';
    renderPanel();
    updateHud(true);
  }

  // ------------------------------------------------------------------- input
  function toBoard(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ((ev.clientX - rect.left) / rect.width) * W, y: ((ev.clientY - rect.top) / rect.height) * H };
  }
  canvas.addEventListener('pointermove', (ev) => { const p = toBoard(ev); hover = { x: p.x, y: p.y, inside: true }; });
  canvas.addEventListener('pointerleave', () => { hover.inside = false; });
  canvas.addEventListener('pointerdown', (ev) => {
    ensureAudio();
    const p = toBoard(ev);
    hover = { x: p.x, y: p.y, inside: true };
    if (state.over) return;
    if (placing) {
      const def = TOWERS[placing];
      if (state.money < def.cost) { toast('Not enough requisition.'); placing = null; renderPanel(); updateHud(); return; }
      if (!canPlace(placing, p.x, p.y)) { toast('Cannot deploy there.'); return; }
      const t = placeTower(placing, p.x, p.y);
      if (!ev.shiftKey || state.money < def.cost) { placing = null; selected = t; }
      renderPanel();
      updateHud();
      return;
    }
    let hit = null;
    for (const t of state.towers) if (Math.hypot(t.x - p.x, t.y - p.y) <= TOWERS[t.type].r + 4) hit = t;
    selected = hit;
    renderPanel();
  });
  canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); placing = null; selected = null; renderPanel(); updateHud(); });

  window.addEventListener('keydown', (ev) => {
    if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    ensureAudio();
    const k = ev.key.toLowerCase();
    const tower = TOWER_KEYS.find((t) => TOWERS[t].key === k);
    if (tower) { beginPlace(tower); return; }
    if (k === ' ') { ev.preventDefault(); startWave(); }
    else if (k === 'escape') { placing = null; selected = null; renderPanel(); updateHud(); }
    else if (k === 'u' || k === 'z' || k === 'x') {
      if (!selected) return;
      if (!selected.trunk) buyAndRefresh('trunk');
      else if (k === 'z') buyAndRefresh(0);
      else if (k === 'x') buyAndRefresh(1);
    }
    else if (k === 's') sellSelected();
    else if (k === 't') cycleMode();
    else if (k === 'f') cycleSpeed();
    else if (k === 'p') togglePause();
  });

  function cycleSpeed() {
    state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 3 : 1;
    $('speedBtn').firstChild.textContent = `Speed ${state.speed}×`;
  }
  function togglePause() {
    state.paused = !state.paused;
    $('pauseBtn').firstChild.textContent = state.paused ? 'Resume' : 'Pause';
  }
  $('startBtn').addEventListener('click', startWave);
  $('speedBtn').addEventListener('click', cycleSpeed);
  $('pauseBtn').addEventListener('click', togglePause);
  $('autoBtn').addEventListener('click', () => {
    state.auto = !state.auto;
    state.autoTimer = 60;
    $('autoBtn').textContent = `Auto-wave: ${state.auto ? 'on' : 'off'}`;
    $('autoBtn').classList.toggle('on', state.auto);
  });
  $('muteBtn').addEventListener('click', () => {
    ensureAudio();
    muted = !muted;
    $('muteBtn').textContent = `Sound: ${muted ? 'off' : 'on'}`;
  });
  const chapterSel = $('chapter');
  for (const [k, v] of Object.entries(CHAPTERS)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = v.name;
    chapterSel.appendChild(o);
  }
  chapterSel.value = chapter;
  chapterSel.addEventListener('change', () => {
    chapter = chapterSel.value;
    try { localStorage.setItem('bloomfall-chapter', chapter); } catch (e) { /* storage unavailable */ }
    for (const k of [...spriteCache.keys()]) if (!k.startsWith('u|')) spriteCache.delete(k);
    buildShop();
  });

  // -------------------------------------------------------------------- loop
  let dpr = 0;
  function fitCanvas() {
    const want = Math.min(window.devicePixelRatio || 1, 2);
    if (want === dpr) return;
    dpr = want;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderBackground(dpr);
  }
  window.addEventListener('resize', fitCanvas);

  let last = performance.now(), acc = 0, frame = 0, slow = 0;
  function loop(now) {
    const dt = Math.min(100, now - last);
    last = now;
    slow = dt > 34 ? slow + 1 : Math.max(0, slow - 1);
    if (slow > 90) lowQuality = true;
    if (!state.paused && !state.over) {
      acc += (dt / (1000 / 60)) * state.speed;
      let steps = 0;
      while (acc >= 1 && steps < 12) { tick(); acc -= 1; steps++; }
      if (steps >= 12) acc = 0;
    }
    render();
    if (++frame % 6 === 0) { updateHud(); refreshPanelLive(); }
    requestAnimationFrame(loop);
  }

  state = newState();
  prebakeUnits();
  for (const k in UNITS) UNIT_ICONS[k] = unitIcon(k);
  fitCanvas();
  buildShop();
  renderPanel();
  updateHud(true);
  requestAnimationFrame(loop);

  // Exposed for debugging and automated tests.
  window.bloomfall = {
    get state() { return state; }, UNITS, TOWERS, placeTower, canPlace, startWave, tick, waveGroups, buy, nodeFor, spawnUnit,
  };
})();
