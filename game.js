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
  ], 70);
  const AIR = makePath([[-40, 340], [250, 200], [520, 330], [760, 215], [1000, 110]], 100);
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
      over: false, won: false, freeplay: false, seen: new Set(),
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
    state.decals.push({ x: e.x, y: e.y, r: e.u.r * rand(0.8, 1.3), rot: Math.random() * TAU, color: ICHOR[(Math.random() * 4) | 0], life: 900 });
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
    if (x > 880 && y < 190) return false; // the gate
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
        sfx.boom();
        break;
      }
      case 'smash': {
        t.angle = Math.atan2(target.y - t.y, target.x - t.x);
        t.punch = 10;
        if (w.splash) areaHit(target.x, target.y, w.splash, w.hits, ef.dmg, ef.ap, t, opts, w.air ? 'both' : 'ground');
        else damage(target, ef.dmg, ef.ap, t, opts);
        state.fx.push({ type: 'ring', x: target.x, y: target.y, r: Math.max(16, w.splash), life: 14, max: 14 });
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
      burst(L.tx, L.ty, '#c9b89a', 8, 2.5);
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
    burst(sh.tx, sh.ty, '#ffb347', 12, 3.5);
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
      if (p.style === 'missile' && state.time % 2 === 0) state.particles.push({ x: p.x, y: p.y, vx: rand(-0.2, 0.2), vy: rand(-0.2, 0.2), life: 18, max: 18, color: 'rgba(170,170,170,0.6)', size: 3 });
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

    for (const p of state.particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--; }
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

  // -------------------------------------------------------------- background
  const bg = document.createElement('canvas');
  function renderBackground(dpr) {
    bg.width = W * dpr; bg.height = H * dpr;
    const c = bg.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rng = mulberry32(40000);
    const g = c.createRadialGradient(W * 0.5, H * 0.5, 100, W * 0.5, H * 0.5, 650);
    g.addColorStop(0, '#3a332b');
    g.addColorStop(1, '#1d1915');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,240,210,0.05)';
      c.fillRect(rng() * W, rng() * H, rng() * 3 + 1, rng() * 3 + 1);
    }
    for (let i = 0; i < 18; i++) {
      const x = rng() * W, y = rng() * H, r = 10 + rng() * 26;
      if (distToGround(x, y) < r + PATH_W / 2) continue;
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath(); c.ellipse(x, y, r, r * 0.7, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(160,140,110,0.18)'; c.lineWidth = 3;
      c.beginPath(); c.ellipse(x, y - 2, r, r * 0.7, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
    }
    for (let i = 0; i < 14; i++) {
      const x = rng() * W, y = rng() * H;
      if (distToGround(x, y) < 50) continue;
      const n = 2 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) {
        const w = 6 + rng() * 22, h = 5 + rng() * 9;
        const bx = x + k * 9 + rng() * 6, by = y + rng() * 8;
        c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(bx + 3, by + 3, w, h);
        c.fillStyle = shade('#5b544b', Math.floor(rng() * 30 - 15)); c.fillRect(bx, by, w, h);
        c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(bx, by, w, 2);
      }
    }
    // bio-creep spreading from the spawning pool
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 0.9 - Math.PI * 0.45, dist = Math.pow(rng(), 1.6) * 330;
      const x = Math.cos(a) * dist, y = 90 + Math.sin(a) * dist * 1.1, r = 6 + rng() * 22 * (1 - dist / 400);
      c.fillStyle = `rgba(${(90 + rng() * 40) | 0},${(20 + rng() * 20) | 0},${(80 + rng() * 40) | 0},${0.25 + rng() * 0.25})`;
      c.beginPath(); c.ellipse(x, y, r, r * 0.7, rng() * 3, 0, TAU); c.fill();
    }
    // road
    const trace = () => { c.beginPath(); GROUND.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); };
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = '#120f0c'; c.lineWidth = PATH_W + 12; trace(); c.stroke();
    c.strokeStyle = '#4a4339'; c.lineWidth = PATH_W; trace(); c.stroke();
    c.strokeStyle = '#564e43'; c.lineWidth = PATH_W - 14; trace(); c.stroke();
    c.setLineDash([14, 18]); c.strokeStyle = 'rgba(201,162,74,0.22)'; c.lineWidth = 3; trace(); c.stroke();
    c.setLineDash([]);
    for (let d = 0; d < GROUND.len; d += 26) {
      const p = posAt(GROUND, d), nx = -Math.sin(p.ang), ny = Math.cos(p.ang);
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(p.x + nx * (PATH_W / 2 - 2), p.y + ny * (PATH_W / 2 - 2)); c.lineTo(p.x - nx * (PATH_W / 2 - 2), p.y - ny * (PATH_W / 2 - 2)); c.stroke();
    }
    // flight lane
    c.save();
    c.setLineDash([3, 12]); c.lineWidth = 2; c.strokeStyle = 'rgba(190,120,230,0.28)';
    c.beginPath(); AIR.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
    c.restore();
    for (let d = 120; d < AIR.end; d += 220) {
      const p = posAt(AIR, d);
      c.save(); c.translate(p.x, p.y); c.rotate(p.ang);
      c.fillStyle = 'rgba(190,120,230,0.35)';
      c.beginPath(); c.moveTo(6, 0); c.lineTo(-4, -5); c.lineTo(-1, 0); c.lineTo(-4, 5); c.fill();
      c.restore();
    }
    const v = c.createRadialGradient(W / 2, H / 2, 280, W / 2, H / 2, 640);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }

  // --------------------------------------------------------- tyranid drawing
  // All drawers face +x and are called after translate/rotate to the unit.
  const NID = { skin: '#e6d8b8', skinD: '#a8987a', cara: '#5e1f63', caraL: '#8e3c92', caraD: '#33103a', claw: '#f2ead6', eye: '#ffd23a', gun: '#4a2236' };

  function leg(c, ax, ay, ang, len, swing) {
    const a1 = ang + swing;
    const kx = ax + Math.cos(a1) * len * 0.55, ky = ay + Math.sin(a1) * len * 0.55;
    const a2 = a1 + (ay >= 0 ? 0.7 : -0.7);
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(kx, ky); c.lineTo(kx + Math.cos(a2) * len * 0.5, ky + Math.sin(a2) * len * 0.5); c.stroke();
  }
  // pairs: [anchorX, halfWidth, length, forwardTilt]
  function legs(c, t, pairs, col, width) {
    c.strokeStyle = col; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
    pairs.forEach(([ax, hw, len, tilt], i) => {
      for (const sd of [-1, 1]) {
        const ph = t + i * Math.PI + (sd > 0 ? Math.PI : 0);
        leg(c, ax, sd * hw, sd * (Math.PI / 2 - tilt), len, Math.sin(ph) * 0.45 * sd);
      }
    });
  }
  function talon(c, ax, ay, sd, len, col) {
    const ex = ax + len * 0.45, ey = ay + sd * len * 0.2;
    c.strokeStyle = NID.skinD; c.lineWidth = Math.max(1.2, len * 0.12);
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ex, ey); c.stroke();
    c.fillStyle = col || NID.claw;
    c.beginPath();
    c.moveTo(ex, ey - sd * 1);
    c.quadraticCurveTo(ex + len * 0.6, ey + sd * len * 0.2, ex + len * 0.55, ey - sd * len * 0.25);
    c.quadraticCurveTo(ex + len * 0.35, ey + sd * len * 0.02, ex, ey + sd * 1.3);
    c.fill();
  }
  function plated(c, x, y, rx, ry, n, col) {
    blob(c, x, y, rx, ry, col || NID.cara);
    c.strokeStyle = NID.caraD; c.lineWidth = 0.9;
    for (let k = 1; k < n; k++) {
      const px = x - rx + (2 * rx * k) / n;
      const h = ry * Math.sqrt(1 - Math.pow((px - x) / rx, 2)) * 0.9;
      c.beginPath(); c.moveTo(px, y - h); c.quadraticCurveTo(px + rx * 0.15, y, px, y + h); c.stroke();
    }
    blob(c, x - rx * 0.2, y - ry * 0.35, rx * 0.45, ry * 0.2, 'rgba(255,255,255,0.12)');
  }
  function eyes(c, x, w, r, col) { dot(c, x, -w, r, col || NID.eye); dot(c, x, w, r, col || NID.eye); }
  function wings(c, t, span, len, col) {
    const k = 0.5 + 0.5 * Math.abs(Math.sin(t));
    for (const sd of [-1, 1]) {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(2, sd * 2);
      c.lineTo(-len * 0.2, sd * span * k);
      c.lineTo(-len * 0.55, sd * span * k * 0.85);
      c.lineTo(-len * 0.45, sd * span * k * 0.5);
      c.lineTo(-len * 0.8, sd * span * k * 0.45);
      c.lineTo(-len * 0.4, sd * 2);
      c.fill();
      c.strokeStyle = NID.caraL; c.lineWidth = 1;
      c.beginPath(); c.moveTo(2, sd * 2); c.lineTo(-len * 0.2, sd * span * k); c.lineTo(-len * 0.55, sd * span * k * 0.85); c.stroke();
    }
  }
  function tail(c, x0, len, t, w, col) {
    c.strokeStyle = col || NID.skinD; c.lineWidth = w; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x0, 0);
    c.quadraticCurveTo(x0 - len * 0.5, Math.sin(t) * len * 0.15, x0 - len, Math.sin(t + 1) * len * 0.2);
    c.stroke();
  }

  const DRAW = {
    ripper(c, t) {
      for (const [ox, oy, ph] of [[3, 0, 0], [-4, 4, 2], [-3, -4.5, 4]]) {
        c.save(); c.translate(ox, oy);
        for (let s = 3; s >= 0; s--) blob(c, -s * 2.2, Math.sin(t * 2 + ph + s) * 1.2, 2.2 - s * 0.3, 1.9 - s * 0.25, s ? '#9a4a72' : '#c26a8e');
        dot(c, 1.6, 0, 0.9, '#3a0f2a');
        c.restore();
      }
    },
    termagant(c, t) {
      legs(c, t, [[0, 2.5, 7, 0.4], [-3, 2.5, 7, -0.2]], NID.skinD, 1.2);
      blob(c, -4, 0, 4.2, 3.4, NID.skin);
      blob(c, -4.2, 0, 3, 2.3, NID.cara);
      plated(c, 0.5, 0, 3.4, 3.2, 2);
      blob(c, 4, 0, 2.8, 2.4, NID.cara);
      blob(c, 5.2, 0, 1.5, 1.7, NID.skin);
      eyes(c, 5.6, 1, 0.5);
      c.fillStyle = NID.gun; rr(c, 1, 2.4, 7, 2.4, 1); c.fill();
      dot(c, 8, 3.6, 1, '#d86a4a');
    },
    hormagaunt(c, t) {
      legs(c, t, [[0, 2.2, 9, 0.5], [-3.5, 2.2, 9, -0.3]], NID.skinD, 1.2);
      tail(c, -7, 6, t, 1.6);
      blob(c, -4.5, 0, 4, 3, NID.skin);
      blob(c, -4.5, 0, 2.8, 2, NID.cara);
      plated(c, 0, 0, 3, 2.8, 2);
      blob(c, 3.6, 0, 2.4, 2.1, NID.cara);
      eyes(c, 5, 0.9, 0.5);
      talon(c, 1, -2.6, -1, 8);
      talon(c, 1, 2.6, 1, 8);
    },
    gargoyle(c, t) {
      wings(c, t * 2.2, 13, 12, 'rgba(110,35,100,0.92)');
      tail(c, -5, 7, t, 1.4);
      blob(c, -3.5, 0, 3.2, 2.4, NID.skin);
      plated(c, 0, 0, 2.8, 2.6, 2);
      blob(c, 3, 0, 2.2, 2, NID.cara);
      eyes(c, 4.4, 0.8, 0.5, '#ff6b3b');
      c.fillStyle = NID.gun; rr(c, 0, 2, 5, 1.8, 0.8); c.fill();
    },
    genestealer(c, t) {
      const GS = '#4f5f9a', GD = '#36427a';
      legs(c, t, [[-1, 2.5, 8, 0.4], [-4, 2.5, 8, -0.3]], GD, 1.4);
      blob(c, -5, 0, 3.8, 3, GS);
      plated(c, -4.5, 0, 3, 2.3, 2);
      blob(c, 0, 0, 3.4, 3.2, GS);
      for (const sd of [-1, 1]) {
        c.strokeStyle = GD; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(1, sd * 2.5); c.lineTo(5, sd * 6); c.lineTo(9, sd * 5); c.stroke();
        c.beginPath(); c.moveTo(1.5, sd * 1.5); c.lineTo(6, sd * 3); c.stroke();
        c.strokeStyle = NID.claw; c.lineWidth = 0.9;
        for (const k of [-1, 0, 1]) { c.beginPath(); c.moveTo(9, sd * 5); c.lineTo(11.5, sd * 5 + k * 1.3); c.stroke(); }
      }
      blob(c, 4.2, 0, 3.2, 2.9, '#8a86c0');
      blob(c, 3.4, 0, 2, 2.2, 'rgba(255,255,255,0.12)');
      eyes(c, 6.2, 1.1, 0.6);
    },
    warrior(c, t) {
      legs(c, t, [[-4, 3.5, 12, 0.1]], NID.skinD, 2.2);
      tail(c, -10, 6, t, 2);
      blob(c, -6.5, 0, 5.5, 4.3, NID.skin);
      plated(c, -6.5, 0, 4.2, 3.2, 3);
      plated(c, 0, 0, 4.8, 4.4, 3);
      c.fillStyle = '#6a2a4a'; rr(c, 0, 4.2, 10, 3.2, 1.5); c.fill();
      dot(c, 10.5, 5.8, 1.3, '#9dff5a');
      c.strokeStyle = NID.claw; c.lineWidth = 2;
      c.beginPath(); c.moveTo(1, -4.5); c.lineTo(14, -7); c.stroke();
      talon(c, 3, -3, -1, 11);
      talon(c, 3, 3, 1, 11);
      blob(c, 6, 0, 3.4, 3, NID.cara);
      c.fillStyle = NID.skin;
      for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(5.5, sd * 1); c.lineTo(0, sd * 5.5); c.lineTo(4, sd * 2.5); c.fill(); }
      blob(c, 8, 0, 1.8, 2, NID.skin);
      eyes(c, 8.6, 1.1, 0.6);
    },
    lictor(c, t) {
      const LC = '#3f5a3a';
      legs(c, t, [[-1, 2.5, 14, 0.4], [-6, 2.5, 13, -0.3]], NID.skinD, 1.2);
      tail(c, -10, 5, t, 1.6);
      blob(c, -6, 0, 5.5, 3, NID.skin);
      plated(c, -6, 0, 4, 2.2, 3, LC);
      plated(c, 0, 0, 4, 3.3, 2, LC);
      talon(c, 1, -3, -1, 13);
      talon(c, 1, 3, 1, 13);
      blob(c, 5, 0, 3, 2.6, LC);
      c.strokeStyle = NID.skin; c.lineWidth = 0.9;
      for (const k of [-1.2, -0.4, 0.4, 1.2]) { c.beginPath(); c.moveTo(7.5, k); c.quadraticCurveTo(10, k * 2 + Math.sin(t * 2 + k) * 1.5, 12, k * 1.6); c.stroke(); }
      eyes(c, 6.4, 1.2, 0.6, '#c8ff6a');
    },
    zoanthrope(c, t) {
      c.strokeStyle = 'rgba(140,255,160,0.45)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(0, 0, 13 + Math.sin(t * 6), 0, TAU); c.stroke();
      blob(c, 0, 0, 12, 11, 'rgba(120,255,150,0.08)');
      tail(c, -3, 9, t * 3, 3, NID.skinD);
      c.strokeStyle = NID.skinD; c.lineWidth = 1;
      for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(-1, sd * 3); c.lineTo(3, sd * 6); c.stroke(); }
      blob(c, 1, 0, 7, 6.5, '#e4c8d0');
      c.strokeStyle = '#b88a9c'; c.lineWidth = 0.9;
      for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(-1 + k * 1.2, 0, 2 + k * 1.3, Math.PI * 0.6, Math.PI * 1.4); c.stroke(); }
      c.beginPath(); c.moveTo(-5, 0); c.lineTo(6, 0); c.stroke();
      plated(c, 6, 0, 2.6, 3.4, 2);
      eyes(c, 7.4, 1.3, 0.8, '#9dff7a');
    },
    harpy(c, t) {
      wings(c, t * 1.6, 26, 22, 'rgba(100,30,95,0.92)');
      tail(c, -9, 14, t, 2.4);
      blob(c, -8, 0, 6, 4.5, NID.skin);
      plated(c, -8, 0, 4.5, 3.4, 3);
      plated(c, 0, 0, 5, 5, 3);
      c.fillStyle = NID.gun;
      rr(c, 0, -8, 11, 3, 1.2); c.fill();
      rr(c, 0, 5, 11, 3, 1.2); c.fill();
      blob(c, 6.5, 0, 3.5, 3.2, NID.cara);
      eyes(c, 8.5, 1.3, 0.7, '#ff6b3b');
    },
    carnifex(c, t) {
      legs(c, t, [[-2, 6, 13, 0.3], [-9, 6, 13, -0.3]], NID.skinD, 3.2);
      tail(c, -14, 8, t, 3.5);
      blob(c, -22, Math.sin(t + 1) * 1.6, 2.6, 2.6, NID.claw);
      blob(c, -8, 0, 7, 6, NID.skin);
      plated(c, -1, 0, 9, 8, 4);
      c.fillStyle = NID.claw;
      for (let k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(k * 2.4 - 1.2, -0.8); c.lineTo(k * 2.4 - 3, 0); c.lineTo(k * 2.4 - 1.2, 0.8); c.fill(); }
      talon(c, 2, -7.5, -1, 13);
      talon(c, 2, 7.5, 1, 13);
      talon(c, 5, -5, -1, 15);
      talon(c, 5, 5, 1, 15);
      blob(c, 8.5, 0, 4, 3.6, NID.caraD);
      c.fillStyle = NID.claw;
      c.beginPath(); c.moveTo(11, -2); c.lineTo(6, -5); c.lineTo(7, -1); c.fill();
      c.beginPath(); c.moveTo(11, 2); c.lineTo(6, 5); c.lineTo(7, 1); c.fill();
      eyes(c, 11, 1.4, 0.8, '#ff4b2b');
    },
    tervigon(c, t) {
      legs(c, t, [[3, 7, 15, 0.4], [-4, 8, 16, 0], [-11, 8, 15, -0.4]], NID.skinD, 3);
      blob(c, -11, 0, 13, 11, '#d9b8b0');
      c.strokeStyle = 'rgba(120,40,70,0.4)'; c.lineWidth = 1;
      for (const k of [-6, -1, 4]) { c.beginPath(); c.moveTo(-22, k); c.quadraticCurveTo(-12, k * 1.6, -2, k * 0.5); c.stroke(); }
      for (const [x, y] of [[-15, -4], [-9, 5], [-17, 4], [-7, -5]]) blob(c, x, y, 2.6, 1.8, 'rgba(110,60,90,0.6)');
      plated(c, 3, 0, 8, 8.5, 4);
      talon(c, 8, -5, -1, 8);
      talon(c, 8, 5, 1, 8);
      blob(c, 11, 0, 4, 3.6, NID.cara);
      eyes(c, 13, 1.3, 0.8);
    },
    tyrant(c, t) {
      legs(c, t, [[-4, 5, 16, 0.1]], NID.skinD, 3.5);
      tail(c, -12, 14, t, 3);
      blob(c, -8, 0, 7, 6, NID.skin);
      plated(c, -8, 0, 5.5, 4.6, 3);
      plated(c, 1, 0, 7, 7, 4);
      c.strokeStyle = NID.claw; c.lineWidth = 2.4;
      for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(2, sd * 7); c.lineTo(17, sd * 11); c.stroke(); }
      talon(c, 5, -5, -1, 15);
      talon(c, 5, 5, 1, 15);
      c.fillStyle = NID.claw;
      for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) {
        c.beginPath(); c.moveTo(9, sd * 1); c.lineTo(1 - k * 2, sd * (5 + k * 2.2)); c.lineTo(8 - k, sd * 2.5); c.fill();
      }
      blob(c, 9, 0, 4.2, 3.8, NID.cara);
      blob(c, 11, 0, 2.2, 2.4, NID.skin);
      eyes(c, 12, 1.3, 0.8);
    },
    titan(c, t) {
      const r = 36;
      c.strokeStyle = NID.claw; c.lineWidth = 4.5; c.lineCap = 'round';
      for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) {
        const bx = (k - 1) * r * 0.8, sw = Math.sin(t + k * 2 + (sd > 0 ? Math.PI : 0)) * r * 0.3;
        c.beginPath(); c.moveTo(bx, sd * r * 0.5);
        c.lineTo(bx + sw * 0.5, sd * r * 1.25); c.lineTo(bx + sw + r * 0.15, sd * r * 1.6); c.stroke();
      }
      const g = c.createRadialGradient(-r * 0.4, -r * 0.3, 4, 0, 0, r * 1.6);
      g.addColorStop(0, '#c26a8a'); g.addColorStop(0.6, '#8a3a5c'); g.addColorStop(1, '#2a0c22');
      c.fillStyle = g;
      c.beginPath(); c.ellipse(0, 0, r * 1.5, r * 0.85, 0, 0, TAU); c.fill();
      for (let k = -2; k <= 1; k++) {
        blob(c, k * r * 0.55, 0, r * 0.36, r * 0.62, NID.claw);
        blob(c, k * r * 0.55, 0, r * 0.24, r * 0.48, NID.cara);
      }
      blob(c, r * 1.35, 0, r * 0.45, r * 0.4, NID.claw);
      blob(c, r * 1.3, 0, r * 0.3, r * 0.26, NID.cara);
      eyes(c, r * 1.5, r * 0.14, 2.6);
      c.strokeStyle = NID.claw; c.lineWidth = 3.5;
      for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(r * 1.2, sd * r * 0.35); c.quadraticCurveTo(r * 1.9, sd * r * 0.9, r * 2.1, sd * r * 0.3); c.stroke(); }
    },
  };

  function drawUnit(c, e) {
    const u = e.u;
    const t = state.time * u.gait + e.phase;
    if (u.fly) {
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.beginPath(); c.ellipse(e.x + 10, e.y + 18, u.r * 0.9, u.r * 0.45, 0, 0, TAU); c.fill();
    }
    c.save();
    c.translate(e.x, e.y + (u.key === 'zoanthrope' ? Math.sin(t * 8) * 1.5 : 0));
    c.rotate(e.facing);
    c.scale(UNIT_SCALE, UNIT_SCALE);
    if (u.camo) c.globalAlpha = 0.45 + 0.1 * Math.sin(state.time * 0.1);
    DRAW[u.key](c, t);
    if (e.flash > 0) { c.globalAlpha = 0.5; blob(c, 0, 0, u.r, u.r * 0.75, '#fff'); }
    c.restore();
    if (u.camo) {
      c.save();
      c.strokeStyle = 'rgba(160,210,120,0.6)'; c.lineWidth = 1.2; c.setLineDash([3, 4]);
      c.lineDashOffset = -state.time * 0.5;
      c.beginPath(); c.arc(e.x, e.y, u.r + 5, 0, TAU); c.stroke();
      c.restore();
    }
    if (e.slowT > 0) {
      c.strokeStyle = e.slowMul === 0 ? 'rgba(255,240,150,0.8)' : 'rgba(120,200,255,0.7)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(e.x, e.y, u.r + 2, 0, TAU); c.stroke();
    }
    if (e.hp < e.maxHp && e.maxHp >= 15) {
      const bw = u.boss ? 80 : Math.max(18, u.r * 2), k = Math.max(0, e.hp / e.maxHp);
      const by = e.y - u.r - (u.boss ? 30 : 10);
      c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(e.x - bw / 2, by, bw, u.boss ? 7 : 4);
      c.fillStyle = u.boss ? '#b25ad6' : '#d65a4a'; c.fillRect(e.x - bw / 2 + 1, by + 1, (bw - 2) * k, u.boss ? 5 : 2);
    }
  }

  // ---------------------------------------------------- space marine drawing
  // Top-down models on round tabletop bases, facing +x, weapon held on the right (+y).
  function muzzle(c, x, y, r) { dot(c, x, y, r, '#ffd36b'); dot(c, x, y, r * 0.5, '#fff6d0'); }

  function drawWeapon(c, w, T, f) {
    const flash = f && f.flash > 3;
    switch (w) {
      case 'bolter':
        c.fillStyle = '#1e1e1e'; c.fillRect(0, 1.6, 12, 3.2);
        c.fillStyle = '#4a4a4a'; c.fillRect(11, 2.1, 2.2, 2.2);
        c.fillStyle = T; c.fillRect(3, 1.6, 2.5, 1);
        if (flash) muzzle(c, 14.5, 3.2, 2.6);
        break;
      case 'boltpistol':
        c.fillStyle = '#1e1e1e'; c.fillRect(1.5, 2.2, 7, 2.4);
        if (flash) muzzle(c, 10, 3.4, 2);
        break;
      case 'heavybolter':
        c.strokeStyle = '#b8902f'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(1, 5.6); c.quadraticCurveTo(-5, 8.5, -9, 4); c.stroke();
        c.fillStyle = '#1b1b1b'; c.fillRect(-1, 1.4, 15, 4.6);
        c.fillStyle = '#3d3d3d'; c.fillRect(13.5, 2.2, 4.5, 3);
        if (flash) muzzle(c, 19.5, 3.7, 3.2);
        break;
      case 'missile':
        c.fillStyle = '#2c3326'; c.fillRect(-7, 2.8, 22, 5);
        c.fillStyle = T; c.fillRect(12, 2.8, 2, 5);
        dot(c, 15, 5.3, 1.8, '#111');
        if (flash) dot(c, -8, 5.3, 3, 'rgba(255,200,120,0.8)');
        break;
      case 'plasma':
        c.fillStyle = '#22262d'; c.fillRect(-1, 1.6, 14, 4);
        c.fillStyle = flash ? '#e8fbff' : '#5ec8ff';
        for (let k = 0; k < 3; k++) c.fillRect(2 + k * 3.4, 1.1, 1.6, 5);
        dot(c, 14, 3.6, flash ? 3 : 1.6, '#8fe0ff');
        break;
      case 'flamer':
        c.fillStyle = '#2a2a24'; c.fillRect(0, 1.8, 11, 3);
        dot(c, 3, 5.6, 1.8, '#8a2a10');
        dot(c, 12, 3.3, flash ? 2.6 : 1.1, '#ff9a3a');
        break;
      case 'chainsword':
        c.fillStyle = '#1e1e1e'; c.fillRect(1, -4.8, 6, 2);
        c.fillStyle = '#222'; c.fillRect(0, 3.2, 3.5, 2.2);
        c.fillStyle = '#9ea3a8'; c.fillRect(3, 3, 13, 2.6);
        c.fillStyle = '#3a3a3a';
        for (let x = 4; x < 16; x += 2) c.fillRect(x, 5.4, 1, 1);
        break;
      case 'claws':
        c.strokeStyle = '#c8d8e8'; c.lineWidth = 1;
        for (const sd of [-1, 1]) for (const k of [-1, 0, 1]) { c.beginPath(); c.moveTo(3, sd * 4.5 + k * 0.8); c.lineTo(11, sd * 4.5 + k * 1.4); c.stroke(); }
        c.fillStyle = 'rgba(120,200,255,0.25)'; c.fillRect(3, -6, 9, 3); c.fillRect(3, 3, 9, 3);
        break;
      case 'hammer':
        c.fillStyle = T; rr(c, -1, -10, 8, 5, 1.5); c.fill();
        c.strokeStyle = '#3a2a1a'; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(0, 4); c.lineTo(13, 4); c.stroke();
        c.fillStyle = '#8a8f96'; c.fillRect(11, 0.5, 5, 7);
        c.strokeStyle = 'rgba(120,200,255,0.7)'; c.lineWidth = 1; c.strokeRect(11, 0.5, 5, 7);
        break;
      case 'shotgun':
        c.fillStyle = '#2a2420'; c.fillRect(0.5, 1.8, 11, 2.4);
        c.fillStyle = '#5a3a22'; c.fillRect(0.5, 1.8, 4, 2.4);
        if (flash) muzzle(c, 12.5, 3, 2.4);
        break;
      case 'sniper':
        c.fillStyle = '#262626'; c.fillRect(-1, 2, 18, 1.6);
        c.fillStyle = '#555'; c.fillRect(4, 1, 5, 1.2);
        if (flash) muzzle(c, 18, 2.8, 2);
        break;
      case 'staff':
        c.strokeStyle = '#d4af37'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(-5, 4.5); c.lineTo(14, 3.5); c.stroke();
        dot(c, 14.5, 3.5, flash ? 3.4 : 2, '#7fd4ff');
        break;
      case 'crozius':
        c.fillStyle = '#1e1e1e'; c.fillRect(1, -4.8, 6, 2);
        c.strokeStyle = '#2a1a10'; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(-1, 4); c.lineTo(11, 4); c.stroke();
        c.fillStyle = '#d4af37';
        c.beginPath(); c.moveTo(10, 4); c.lineTo(14.5, 0); c.lineTo(13, 4); c.lineTo(14.5, 8); c.closePath(); c.fill();
        dot(c, 12.2, 4, 1.1, '#efe8d8');
        break;
    }
  }

  function drawBase(c, r) {
    dot(c, 0, 0, r, '#121110');
    c.strokeStyle = '#3a3530'; c.lineWidth = 1; c.stroke();
  }

  function drawMarine(c, x, y, ang, m, f) {
    const ch = CHAPTERS[chapter];
    const A = m.armour || ch.armour, T = m.trim || ch.trim;
    const D = shade(A, -45), L = shade(A, 45);
    const s = m.scale || 1;
    c.save();
    c.translate(x, y);
    if (!(f && f.airborne)) drawBase(c, 9.5 * s);
    c.rotate(ang);
    c.scale(s, s);
    if (m.pack === 'jump') {
      if (f && f.jumping) {
        for (const sd of [-1, 1]) {
          c.fillStyle = '#ffb030';
          c.beginPath(); c.moveTo(-12, sd * 3.8 - 1.8); c.lineTo(-12, sd * 3.8 + 1.8); c.lineTo(-20 - Math.random() * 4, sd * 4.2); c.fill();
          dot(c, -13, sd * 3.8, 1.2, '#fff2b0');
        }
      }
      c.fillStyle = D; rr(c, -11.5, -6, 7.5, 12, 2.5); c.fill();
      dot(c, -11.5, -3.8, 2.3, '#2a2a2a'); dot(c, -11.5, 3.8, 2.3, '#2a2a2a');
      c.fillStyle = T; c.fillRect(-10, -0.8, 4, 1.6);
    } else {
      c.fillStyle = D; rr(c, -9.5, -5, 5.5, 10, 2); c.fill();
      dot(c, -9.6, -3, 1.3, '#2a2a2a'); dot(c, -9.6, 3, 1.3, '#2a2a2a');
    }
    // torso
    c.fillStyle = A; rr(c, -6, -5, 10, 10, 3.5); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 0.8; c.stroke();
    // pauldrons with trim and chapter mark
    for (const sd of [-1, 1]) {
      c.fillStyle = A; c.beginPath(); c.ellipse(-0.5, sd * 6.3, 4.3, 3.7, 0, 0, TAU); c.fill();
      c.strokeStyle = T; c.lineWidth = 1.2; c.stroke();
      blob(c, -1.4, sd * 6.3 - 1, 1.8, 1.1, L);
    }
    dot(c, -0.5, -6.3, 1.3, m.armour ? T : ch.mark);
    drawWeapon(c, m.weapon, T, f);
    // head
    if (m.head === 'skull') {
      dot(c, 1.5, 0, 3.4, '#e9e4d6');
      dot(c, 3.2, -1.2, 0.8, '#111'); dot(c, 3.2, 1.2, 0.8, '#111');
    } else {
      dot(c, 1.4, 0, 3.2, m.head === 'vet' ? T : L);
      c.fillStyle = D; rr(c, 3.3, -1.6, 1.6, 3.2, 0.6); c.fill();
      dot(c, 3.7, -1.5, 0.75, '#e03a2a'); dot(c, 3.7, 1.5, 0.75, '#e03a2a');
    }
    if (m.pack === 'psy') {
      c.strokeStyle = '#d4af37'; c.lineWidth = 1.8;
      c.beginPath(); c.arc(0.8, 0, 4.8, Math.PI * 0.6, Math.PI * 1.4); c.stroke();
      for (const k of [-0.45, 0, 0.45]) dot(c, 0.8 + Math.cos(Math.PI + k) * 4.8, Math.sin(Math.PI + k) * 4.8, 0.9, '#7fd4ff');
    }
    c.restore();
  }

  function drawScout(c, x, y, ang, m, f) {
    const ch = CHAPTERS[chapter];
    c.save();
    c.translate(x, y);
    drawBase(c, 8.5 * (m.scale || 1));
    c.rotate(ang);
    c.scale(m.scale || 1, m.scale || 1);
    if (m.cloak) {
      blob(c, -3, 0, 7, 7.5, '#4a5236');
      for (const [a, b] of [[-5, -3], [-2, 4], [-6, 3], [-1, -5]]) dot(c, a, b, 1.3, '#343a26');
    }
    dot(c, -0.5, -5, 2.8, '#55584a'); dot(c, -0.5, 5, 2.8, '#55584a');
    c.fillStyle = ch.armour; rr(c, -4.5, -4, 8, 8, 2.5); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 0.8; c.stroke();
    drawWeapon(c, m.weapon, ch.trim, f);
    dot(c, 1.2, 0, 2.6, '#d6a882');
    c.fillStyle = '#2e2016'; c.beginPath(); c.arc(0.6, 0, 2.6, Math.PI * 0.5, Math.PI * 1.5); c.fill();
    c.restore();
  }

  function drawDread(c, t, x, y, s) {
    const ch = CHAPTERS[chapter], A = ch.armour, T = ch.trim, D = shade(A, -45), L = shade(A, 45);
    const fire = t.path === 0, melee = t.path === 1;
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = '#121110'; c.beginPath(); c.ellipse(0, 0, 20, 18, 0, 0, TAU); c.fill();
    c.strokeStyle = '#3a3530'; c.lineWidth = 1; c.stroke();
    c.rotate(t.angle);
    const p = (t.punch || 0) * 0.6;
    c.fillStyle = '#2b2b2b'; rr(c, -6, -13, 10, 5, 2); c.fill(); rr(c, -6, 8, 10, 5, 2); c.fill();
    dot(c, -13, -4, 2.6, '#3a3a3a'); dot(c, -13, 4, 2.6, '#3a3a3a');
    dot(c, -13, -4, 1.3, '#111'); dot(c, -13, 4, 1.3, '#111');
    c.fillStyle = A; rr(c, -11, -9, 18, 18, 4); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.stroke();
    c.fillStyle = L; rr(c, -9, -7, 6, 14, 2); c.fill();
    c.fillStyle = T; rr(c, 3, -5, 5, 10, 1.5); c.fill();
    c.fillStyle = D; rr(c, 4, -3.5, 3, 7, 1); c.fill();
    c.fillStyle = shade(A, 20); rr(c, 6, -3, 4.5, 6, 1.5); c.fill();
    dot(c, 10, -1.3, 0.7, '#e03a2a'); dot(c, 10, 1.3, 0.7, '#e03a2a');
    // left arm: Redemptor fist
    blob(c, -1, -11, 5.5, 4.5, D);
    c.fillStyle = '#2a2a2a'; rr(c, p, -14, 11, 6, 2); c.fill();
    c.fillStyle = A; rr(c, 10 + p, -15.5, 6.5, 9, 2); c.fill();
    c.fillStyle = T;
    for (let k = 0; k < 4; k++) c.fillRect(16 + p, -15 + k * 2.2, 2, 1.4);
    if (melee && t.lv >= 2) { c.fillStyle = '#2a2a24'; c.fillRect(3 + p, -8.8, 10, 2.4); }
    if (melee && t.lv >= 3) { c.strokeStyle = 'rgba(120,200,255,0.8)'; c.lineWidth = 1; c.strokeRect(10 + p, -15.5, 6.5, 9); }
    // right arm: gatling, or macro plasma once bought
    blob(c, -1, 11, 5.5, 4.5, D);
    if (fire && t.lv >= 3) {
      c.fillStyle = '#22262d'; rr(c, 0, 8, 22, 6.5, 2); c.fill();
      c.fillStyle = t.flash > 3 ? '#e8fbff' : '#5ec8ff';
      for (let k = 0; k < 4; k++) c.fillRect(4 + k * 4, 7.4, 1.8, 7.7);
    } else {
      c.fillStyle = '#1e1e1e'; rr(c, 0, 8, 16, 6, 2); c.fill();
      c.fillStyle = '#4a4a4a';
      for (let k = 0; k < 4; k++) c.fillRect(15, 8.6 + k * 1.5, 6, 1);
      if (t.flash > 3) muzzle(c, 22, 11, 3);
    }
    if (fire && t.lv >= 2) {
      c.fillStyle = '#2c3326'; rr(c, -9, -19, 9, 5, 1.2); c.fill();
      for (let k = 0; k < 3; k++) dot(c, -7.5 + k * 3, -16.5, 1, '#9c1414');
    }
    c.restore();
  }

  function drawWhirlwind(c, t, x, y, s) {
    const ch = CHAPTERS[chapter], A = ch.armour, T = ch.trim, D = shade(A, -45), L = shade(A, 35);
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = 'rgba(0,0,0,0.4)'; rr(c, -16, -10, 37, 25, 4); c.fill();
    c.fillStyle = '#1b1b1b'; rr(c, -19, -14, 38, 7, 2); c.fill(); rr(c, -19, 7, 38, 7, 2); c.fill();
    c.strokeStyle = '#333'; c.lineWidth = 1;
    for (let k = -17; k < 19; k += 3) { c.beginPath(); c.moveTo(k, -14); c.lineTo(k, -7); c.moveTo(k, 7); c.lineTo(k, 14); c.stroke(); }
    c.fillStyle = A; rr(c, -17, -8.5, 34, 17, 3); c.fill();
    c.strokeStyle = T; c.lineWidth = 1; c.stroke();
    c.fillStyle = D; rr(c, 12, -7.5, 5, 15, 2); c.fill();
    c.fillStyle = L; rr(c, -14, -6, 12, 12, 2); c.fill();
    dot(c, -16, -5, 1.5, '#2a2a2a'); dot(c, -16, 5, 1.5, '#2a2a2a');
    dot(c, -8, 0, 2.2, D);
    c.rotate(t.angle);
    c.fillStyle = '#2a2d26'; rr(c, -6, -6.5, 13, 13, 2); c.fill();
    c.strokeStyle = T; c.stroke();
    const tip = t.path === 1 ? '#ff7a1a' : '#9c1414';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { dot(c, -1.5 + j * 5, -4 + i * 4, 1.6, '#111'); dot(c, -1.5 + j * 5, -4 + i * 4, 0.9, tip); }
    c.restore();
  }

  function drawTower(c, t, x, y, scale) {
    const def = TOWERS[t.type];
    const s = (scale || 1) * MODEL_SCALE;
    if (t.type === 'dreadnought') return drawDread(c, t, x, y, s * 0.9);
    if (t.type === 'whirlwind') return drawWhirlwind(c, t, x, y, s * 0.85);
    const models = def.look(t);
    const off = t.leap ? leapOffset(t) : null;
    models.forEach((m, i) => {
      const [fx, fy] = def.formation[i] || [0, 0];
      const mx = x + fx * s, my = y + fy * s;
      if (off) {
        // the shadow stays on the ground while the marine rises off it
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.beginPath(); c.ellipse(mx + off.dx, my + off.dy, 7, 5, 0, 0, TAU); c.fill();
        drawMarine(c, mx + off.dx, my + off.dy - off.h * 16, t.angle,
          Object.assign({}, m, { scale: (m.scale || 1) * s * (1 + off.h * 0.3) }), { jumping: true, airborne: true });
        return;
      }
      const opts = Object.assign({}, m, { scale: (m.scale || 1) * s });
      const f = { flash: i === (t.shot - 1 + models.length) % models.length ? t.flash : 0 };
      if (m.kind === 'scout') drawScout(c, mx, my, t.angle, opts, f);
      else drawMarine(c, mx, my, t.angle, opts, f);
    });
  }

  function drawRift(c) {
    // Tyranid spawning pool: a pulsing pit of biomass.
    const x = 8, y = 90, t = state.time * 0.04;
    c.save();
    const pulse = 1 + Math.sin(t * 2) * 0.04;
    const g = c.createRadialGradient(x, y, 4, x, y, 62 * pulse);
    g.addColorStop(0, '#f0a0c0'); g.addColorStop(0.35, '#a03a6a'); g.addColorStop(0.75, '#4b1460'); g.addColorStop(1, 'rgba(40,10,40,0)');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(x, y, 52 * pulse, 60 * pulse, 0, 0, TAU); c.fill();
    c.strokeStyle = '#3b1f4a'; c.lineCap = 'round';
    for (let k = 0; k < 7; k++) {
      const a = -1.3 + k * 0.43, sw = Math.sin(t * 3 + k) * 0.25;
      c.lineWidth = 4 - (k % 3);
      c.beginPath(); c.moveTo(x + Math.cos(a) * 30, y + Math.sin(a) * 34);
      c.quadraticCurveTo(x + Math.cos(a + sw) * 52, y + Math.sin(a + sw) * 58, x + Math.cos(a - sw) * 66, y + Math.sin(a - sw) * 70);
      c.stroke();
    }
    c.fillStyle = 'rgba(255,200,220,0.5)';
    for (let k = 0; k < 5; k++) {
      const ph = (t * 0.8 + k * 0.21) % 1;
      c.beginPath(); c.arc(x + 4 + Math.sin(k * 7) * 16, y + Math.cos(k * 5) * 22, 2 + ph * 4, 0, TAU); c.fill();
    }
    // spore cloud where fliers enter
    const g2 = c.createRadialGradient(0, 340, 4, 0, 340, 60);
    g2.addColorStop(0, 'rgba(190,110,220,0.45)'); g2.addColorStop(1, 'rgba(190,110,220,0)');
    c.fillStyle = g2; c.beginPath(); c.arc(0, 340, 60, 0, TAU); c.fill();
    c.restore();
  }

  function drawGate(c) {
    const x = 905, y = 110;
    c.save();
    c.fillStyle = '#1a1714'; c.fillRect(x - 8, y - 62, 64, 124);
    c.fillStyle = '#4a4339'; c.fillRect(x - 4, y - 58, 56, 116);
    c.fillStyle = '#2a2520'; c.fillRect(x + 6, y - 28, 36, 56);
    c.strokeStyle = '#c9a24a'; c.lineWidth = 2;
    c.strokeRect(x + 6, y - 28, 36, 56);
    c.beginPath(); c.moveTo(x + 24, y - 28); c.lineTo(x + 24, y + 28); c.stroke();
    c.fillStyle = '#4a4339';
    for (let k = 0; k < 4; k++) { c.fillRect(x - 4 + k * 15, y - 70, 9, 10); c.fillRect(x - 4 + k * 15, y + 60, 9, 10); }
    c.fillStyle = '#c9a24a';
    c.beginPath(); c.arc(x + 24, y - 42, 5, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(x + 19, y - 42); c.lineTo(x + 4, y - 48); c.lineTo(x + 10, y - 40); c.fill();
    c.beginPath(); c.moveTo(x + 29, y - 42); c.lineTo(x + 44, y - 48); c.lineTo(x + 38, y - 40); c.fill();
    c.restore();
  }

  function render() {
    const c = ctx;
    c.drawImage(bg, 0, 0, W, H);
    for (const d of state.decals) {
      c.globalAlpha = Math.min(0.55, d.life / 300);
      c.save(); c.translate(d.x, d.y); c.rotate(d.rot);
      blob(c, 0, 0, d.r, d.r * 0.6, d.color);
      blob(c, d.r * 0.7, d.r * 0.3, d.r * 0.3, d.r * 0.2, d.color);
      c.restore();
    }
    c.globalAlpha = 1;
    for (const z of state.zones) {
      const k = z.life / z.max;
      const g = c.createRadialGradient(z.x, z.y, 2, z.x, z.y, z.r);
      g.addColorStop(0, `rgba(255,150,40,${0.45 * k})`); g.addColorStop(1, 'rgba(160,40,10,0)');
      c.fillStyle = g; c.beginPath(); c.arc(z.x, z.y, z.r, 0, TAU); c.fill();
      if (Math.random() < 0.3) state.particles.push({ x: z.x + rand(-z.r, z.r) * 0.6, y: z.y + rand(-z.r, z.r) * 0.6, vx: 0, vy: -0.6, life: 16, max: 16, color: '#ff8a2a', size: 3, flame: true });
    }
    drawRift(c);

    if (selected) {
      const s = selected.stats;
      const range = s.aura ? s.aura.radius : effW(selected, s.w[0]).range;
      c.save();
      c.fillStyle = s.aura ? 'rgba(163,34,27,0.12)' : 'rgba(201,162,74,0.10)';
      c.strokeStyle = 'rgba(201,162,74,0.6)'; c.lineWidth = 1.5; c.setLineDash([6, 6]);
      c.beginPath(); c.arc(selected.x, selected.y, range, 0, TAU); c.fill(); c.stroke();
      c.restore();
    }

    // synapse links
    c.strokeStyle = 'rgba(200,130,255,0.22)'; c.lineWidth = 1;
    for (const s of state.enemies) {
      if (!s.u.synapse || s.nulled) continue;
      let n = 0;
      for (const e of state.enemies) {
        if (e === s || !e.synapsed || n > 7) continue;
        if (Math.abs(e.x - s.x) > 90 || Math.abs(e.y - s.y) > 90) continue;
        c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(e.x, e.y); c.stroke();
        n++;
      }
    }

    const ground = state.enemies.filter((e) => !e.u.fly).sort((a, b) => a.y - b.y);
    for (const e of ground) drawUnit(c, e);

    drawGate(c);

    const towers = state.towers.slice().sort((a, b) => a.y - b.y);
    for (const t of towers) if (!t.leap) drawTower(c, t, t.x, t.y);
    if (selected) {
      c.strokeStyle = '#c9a24a'; c.lineWidth = 2;
      c.beginPath(); c.arc(selected.x, selected.y, TOWERS[selected.type].r + 6, 0, TAU); c.stroke();
    }

    for (const e of state.enemies) if (e.u.fly) drawUnit(c, e);
    for (const t of towers) if (t.leap) drawTower(c, t, t.x, t.y);

    for (const p of state.projectiles) {
      if (p.style === 'plasma') {
        dot(c, p.x, p.y, 4, 'rgba(90,190,255,0.45)'); dot(c, p.x, p.y, 2.2, '#e8fbff');
      } else if (p.style === 'missile') {
        c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(p.vy, p.vx));
        c.fillStyle = '#3a3d33'; c.fillRect(-4, -1.3, 7, 2.6);
        dot(c, 3, 0, 1.3, '#9c1414'); dot(c, -5, 0, 1.6, '#ffb030');
        c.restore();
      } else {
        c.strokeStyle = p.style === 'hbolt' ? '#ffd36b' : p.style === 'pellet' ? '#e8d8a8' : '#ffb84a';
        c.lineWidth = p.style === 'hbolt' ? 3 : 2;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.9, p.y - p.vy * 0.9); c.stroke();
      }
    }
    for (const sh of state.shells) {
      if (sh.t < 0) continue;
      const k = sh.t / sh.dur;
      const gx = sh.sx + (sh.tx - sh.sx) * k, gy = sh.sy + (sh.ty - sh.sy) * k;
      const y = gy - Math.sin(k * Math.PI) * 90;
      dot(c, gx, gy, 3, 'rgba(0,0,0,0.3)');
      const dy = (sh.ty - sh.sy) - Math.cos(k * Math.PI) * 90 * Math.PI;
      c.save(); c.translate(gx, y); c.rotate(Math.atan2(dy, sh.tx - sh.sx));
      c.fillStyle = '#3a3d33'; c.fillRect(-5, -1.6, 9, 3.2);
      dot(c, 4, 0, 1.6, sh.w.burn ? '#ff7a1a' : '#9c1414');
      c.restore();
    }

    for (const f of state.fx) {
      const k = f.life / f.max;
      c.save();
      c.globalAlpha = k;
      if (f.type === 'tracer') {
        c.strokeStyle = '#fff2c0'; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(f.x1, f.y1); c.lineTo(f.x2, f.y2); c.stroke();
      } else if (f.type === 'boom') {
        const g = c.createRadialGradient(f.x, f.y, 2, f.x, f.y, f.r);
        if (f.color === 'plasma') { g.addColorStop(0, '#f0fcff'); g.addColorStop(0.4, '#5ec8ff'); g.addColorStop(1, 'rgba(20,60,120,0)'); }
        else { g.addColorStop(0, '#fff2b0'); g.addColorStop(0.4, '#ff9a3a'); g.addColorStop(1, 'rgba(120,30,10,0)'); }
        c.fillStyle = g;
        c.beginPath(); c.arc(f.x, f.y, f.r * (1.2 - k * 0.4), 0, TAU); c.fill();
      } else if (f.type === 'ring') {
        c.strokeStyle = '#e8dcc0'; c.lineWidth = 3 * k;
        c.beginPath(); c.arc(f.x, f.y, f.r * (1.3 - k * 0.6), 0, TAU); c.stroke();
      } else if (f.type === 'vortex') {
        c.translate(f.x, f.y); c.rotate(state.time * 0.2);
        for (let i = 0; i < 3; i++) {
          c.strokeStyle = i % 2 ? '#b25ad6' : '#6fd0ff'; c.lineWidth = 3;
          c.beginPath(); c.arc(0, 0, f.r * (0.4 + i * 0.25), i, i + Math.PI * 1.2); c.stroke();
        }
        blob(c, 0, 0, f.r * 0.3, f.r * 0.3, 'rgba(20,0,40,0.8)');
      } else if (f.type === 'arc') {
        for (const [col, w] of [['#6f8cff', 5], ['#e6f2ff', 1.6]]) {
          c.strokeStyle = col; c.lineWidth = w;
          c.beginPath();
          const rng = mulberry32(Math.floor(state.time / 3) + f.pts.length);
          f.pts.forEach(([x, y], i) => {
            if (!i) { c.moveTo(x, y); return; }
            const [px, py] = f.pts[i - 1];
            for (let s = 1; s <= 3; s++) c.lineTo(px + ((x - px) * s) / 4 + (rng() - 0.5) * 14, py + ((y - py) * s) / 4 + (rng() - 0.5) * 14);
            c.lineTo(x, y);
          });
          c.stroke();
        }
      }
      c.restore();
    }

    for (const p of state.particles) {
      c.globalAlpha = clamp((p.life / p.max) * 1.4, 0, 1);
      c.fillStyle = p.color;
      if (p.flame) { c.beginPath(); c.arc(p.x, p.y, p.size * (1.4 - (p.life / p.max) * 0.6), 0, TAU); c.fill(); }
      else c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;

    if (placing && hover.inside) {
      const def = TOWERS[placing];
      const ok = canPlace(placing, hover.x, hover.y) && state.money >= def.cost;
      const range = def.base.aura ? def.base.aura.radius : def.base.w[0].range;
      c.save();
      c.fillStyle = ok ? 'rgba(143,220,132,0.12)' : 'rgba(255,80,60,0.15)';
      c.strokeStyle = ok ? 'rgba(143,220,132,0.7)' : 'rgba(255,80,60,0.7)';
      c.setLineDash([5, 5]); c.lineWidth = 1.5;
      c.beginPath(); c.arc(hover.x, hover.y, range, 0, TAU); c.fill(); c.stroke();
      c.restore();
      c.globalAlpha = 0.75;
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
    const u = UNITS[key];
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const c = cv.getContext('2d');
    const reach = { titan: 80, tyrant: 34, tervigon: 34, harpy: 30, carnifex: 30 }[key] || u.r * 1.9;
    c.translate(32, 32); c.scale(28 / reach, 28 / reach); c.rotate(-Math.PI / 2);
    DRAW[key](c, 0.8);
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
      b.addEventListener('click', () => beginPlace(key));
      shop.appendChild(b);
    }
    updateHud(true);
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
        <p>Click open ground to deploy for <b>⚙ ${def.cost}</b>. Hold Shift to deploy several. Esc cancels.</p>
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

  let last = performance.now(), acc = 0, frame = 0;
  function loop(now) {
    const dt = Math.min(100, now - last);
    last = now;
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
