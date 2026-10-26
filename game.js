'use strict';
/*
 * Bloomfall — a grimdark balloon tower defense against a Tyranid spore swarm.
 * Plain canvas + DOM, no dependencies. The simulation runs on a fixed 60 Hz tick;
 * rendering happens once per animation frame.
 */
(() => {
  const W = 960, H = 600;
  const FINAL_WAVE = 40;
  const START_MONEY = 700;
  const START_LIVES = 150;
  const SPEED_BASE = 1.35; // px per tick for a speed-1.0 spore

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
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let k = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    k = clamp(k, 0, 1);
    return Math.hypot(px - (x1 + dx * k), py - (y1 + dy * k));
  }

  // --------------------------------------------------------------------- path
  const PATH_PTS = [
    [-40, 90], [200, 90], [200, 270], [70, 270], [70, 500], [380, 500],
    [380, 160], [580, 160], [580, 430], [790, 430], [790, 110], [1000, 110],
  ];
  const PATH_W = 46;
  const SEGS = [];
  let PATH_LEN = 0;
  for (let i = 0; i < PATH_PTS.length - 1; i++) {
    const [x1, y1] = PATH_PTS[i], [x2, y2] = PATH_PTS[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    SEGS.push({ x1, y1, x2, y2, len, start: PATH_LEN, ang: Math.atan2(y2 - y1, x2 - x1) });
    PATH_LEN += len;
  }
  // The gate sits where the path leaves the board.
  const GATE_D = PATH_LEN - 50;

  function posAt(d) {
    if (d <= 0) {
      const s = SEGS[0];
      return { x: s.x1 + Math.cos(s.ang) * d, y: s.y1 + Math.sin(s.ang) * d, ang: s.ang };
    }
    for (const s of SEGS) {
      if (d <= s.start + s.len) {
        const k = (d - s.start) / s.len;
        return { x: s.x1 + (s.x2 - s.x1) * k, y: s.y1 + (s.y2 - s.y1) * k, ang: s.ang };
      }
    }
    const s = SEGS[SEGS.length - 1];
    return { x: s.x2, y: s.y2, ang: s.ang };
  }
  function distToPath(x, y) {
    let m = Infinity;
    for (const s of SEGS) m = Math.min(m, segDist(x, y, s.x1, s.y1, s.x2, s.y2));
    return m;
  }

  // ------------------------------------------------------------------- spores
  // Each tier pops into its `kids`. RBE ("red bloom equivalent") is the Faith lost if it leaks.
  const TIERS = [
    { name: 'Spore Mine', color: '#c8433a', speed: 1.0, hp: 1, r: 11, kids: [] },
    { name: 'Termagant Spore', color: '#3a6fc4', speed: 1.4, hp: 1, r: 11.5, kids: [0] },
    { name: 'Hormagaunt Spore', color: '#6f9a2c', speed: 1.8, hp: 1, r: 12, kids: [1] },
    { name: 'Gargoyle Spore', color: '#e0b42a', speed: 2.7, hp: 1, r: 12, kids: [2] },
    { name: 'Genestealer Spore', color: '#d9509f', speed: 3.0, hp: 1, r: 12.5, kids: [3] },
    { name: 'Zoanthrope Spore', color: '#2d2a3c', speed: 1.8, hp: 1, r: 9.5, kids: [4, 4], immune: ['explosive'], note: 'Warp field: immune to explosions' },
    { name: 'Pyrovore Spore', color: '#e8d6b8', speed: 2.0, hp: 1, r: 9.5, kids: [4, 4], immune: ['fire'], note: 'Immune to fire' },
    { name: 'Carnifex Spore', color: '#9a8f7c', speed: 1.0, hp: 1, r: 13, kids: [5, 6], armored: true, note: 'Bone armour: needs armour-piercing' },
    { name: 'Tervigon Brood-Sac', color: '#a0506a', speed: 2.4, hp: 10, r: 14, kids: [7, 7], note: 'Takes 10 hits' },
    { name: 'Hierophant Bio-Titan', color: '#4b1460', speed: 0.5, hp: 240, r: 34, kids: [8, 8, 8, 8], boss: true, reward: 100, note: 'Boss' },
  ];
  TIERS.forEach((t) => { t.rbe = t.hp + t.kids.reduce((s, k) => s + TIERS[k].rbe, 0); });

  // ------------------------------------------------------------------ towers
  // `apply` mutates a stats object; a tower's stats are rebuilt from base + owned upgrades.
  const TOWERS = {
    guard: {
      name: 'Guardsman Squad', key: '1', cost: 170, r: 14, color: '#7f8150',
      blurb: 'Cheap, steady lasgun fire.',
      base: { kind: 'proj', dtype: 'las', range: 125, rate: 36, dmg: 1, pierce: 2, speed: 10, count: 1, spread: 0, projColor: '#ff6040' },
      ups: [
        { name: 'Hot-Shot Packs', cost: 120, desc: '+1 pierce, +10 range', apply: (s) => { s.pierce += 1; s.range += 10; } },
        { name: 'Veteran Sergeant', cost: 200, desc: 'Fires 35% faster', apply: (s) => { s.rate *= 0.65; } },
        { name: 'Auspex Scanner', cost: 180, desc: 'Can see camouflaged spores', apply: (s) => { s.camo = true; } },
        { name: 'Storm Volley', cost: 950, desc: 'Three shots per volley, +1 damage', apply: (s) => { s.count = 3; s.spread = 0.2; s.dmg += 1; s.rate *= 0.85; } },
      ],
    },
    bolter: {
      name: 'Heavy Bolter Team', key: '2', cost: 420, r: 16, color: '#4f6440',
      blurb: 'Fast stream of explosive-tipped rounds.',
      base: { kind: 'proj', dtype: 'bolt', range: 150, rate: 10, dmg: 1, pierce: 1, speed: 13, count: 1, spread: 0.06, projColor: '#ffd36b' },
      ups: [
        { name: 'Extended Ammo Belts', cost: 300, desc: 'Fires 30% faster', apply: (s) => { s.rate *= 0.7; } },
        { name: 'Penetrator Rounds', cost: 450, desc: 'Pierces armour, +1 pierce', apply: (s) => { s.ap = true; s.pierce += 1; } },
        { name: 'Targeting Auspex', cost: 300, desc: 'Sees camouflaged spores, +25 range', apply: (s) => { s.camo = true; s.range += 25; } },
        { name: 'Twin-Linked Barrels', cost: 1600, desc: 'Two streams, +1 damage', apply: (s) => { s.count = 2; s.spread = 0.08; s.dmg += 1; } },
      ],
    },
    flamer: {
      name: 'Flamer Sentinel', key: '3', cost: 480, r: 17, color: '#6b6a55',
      blurb: 'Short-range cone of fire. Hits crowds.',
      base: { kind: 'flame', dtype: 'fire', range: 80, rate: 24, dmg: 1, pierce: 10, cone: 0.7 },
      ups: [
        { name: 'Promethium Tanks', cost: 250, desc: '+18 range', apply: (s) => { s.range += 18; } },
        { name: 'Heavy Flamer', cost: 420, desc: '+1 damage, +8 targets', apply: (s) => { s.dmg += 1; s.pierce += 8; } },
        { name: 'Pressurised Nozzle', cost: 500, desc: 'Fires 40% faster', apply: (s) => { s.rate *= 0.6; } },
        { name: 'Melta Projector', cost: 1800, desc: 'Melts armour, +3 damage', apply: (s) => { s.ap = true; s.dmg += 3; } },
      ],
    },
    mortar: {
      name: 'Mortar Battery', key: '4', cost: 620, r: 18, color: '#5d5240',
      blurb: 'Long-range shells with splash. Cracks armour.',
      base: { kind: 'shell', dtype: 'explosive', ap: true, range: 270, rate: 95, dmg: 1, pierce: 18, splash: 46, flight: 40 },
      ups: [
        { name: 'Frag Shells', cost: 300, desc: '+16 blast radius, +10 targets', apply: (s) => { s.splash += 16; s.pierce += 10; } },
        { name: 'Krak Shells', cost: 450, desc: '+2 damage', apply: (s) => { s.dmg += 2; } },
        { name: 'Rapid Loaders', cost: 550, desc: 'Fires 40% faster', apply: (s) => { s.rate *= 0.6; } },
        { name: 'Earthshaker Battery', cost: 2400, desc: '+4 damage, huge blasts, +80 range', apply: (s) => { s.dmg += 4; s.splash += 24; s.range += 80; s.pierce += 20; } },
      ],
    },
    lascannon: {
      name: 'Lascannon Nest', key: '5', cost: 760, r: 16, color: '#3f4f63',
      blurb: 'Slow, brutal beam. Pierces armour.',
      base: { kind: 'beam', dtype: 'las', ap: true, range: 330, rate: 75, dmg: 5, pierce: 1 },
      ups: [
        { name: 'Focusing Crystals', cost: 400, desc: '+4 damage', apply: (s) => { s.dmg += 4; } },
        { name: 'Capacitor Banks', cost: 600, desc: 'Fires 40% faster', apply: (s) => { s.rate *= 0.6; } },
        { name: 'Night-Fighting Optics', cost: 350, desc: 'Sees camouflaged spores', apply: (s) => { s.camo = true; } },
        { name: 'Annihilator Lance', cost: 3000, desc: '+20 damage, beam pierces 5', apply: (s) => { s.dmg += 20; s.pierce += 4; s.rate *= 0.8; } },
      ],
    },
    psyker: {
      name: 'Sanctioned Psyker', key: '6', cost: 900, r: 14, color: '#3d4c8a',
      blurb: 'Chain lightning. Sees camouflaged spores, ignores armour.',
      base: { kind: 'chain', dtype: 'psychic', ap: true, camo: true, range: 145, rate: 55, dmg: 1, chain: 4 },
      ups: [
        { name: 'Warp Conduit', cost: 450, desc: 'Arcs to 3 more spores', apply: (s) => { s.chain += 3; } },
        { name: 'Overcharged Mind', cost: 700, desc: '+1 damage', apply: (s) => { s.dmg += 1; } },
        { name: 'Psychic Storm', cost: 900, desc: 'Fires 40% faster, +20 range', apply: (s) => { s.rate *= 0.6; s.range += 20; } },
        { name: 'Alpha-Level Psyker', cost: 3200, desc: 'Arcs to 8 more, +2 damage', apply: (s) => { s.chain += 8; s.dmg += 2; } },
      ],
    },
    commissar: {
      name: 'Commissar', key: '7', cost: 750, r: 14, color: '#2a2422',
      blurb: 'Does not shoot. Nearby defenders fire 12% faster.',
      base: { kind: 'aura', range: 120, buffRate: 0.88, buffDmg: 0, buffCamo: false, buffRange: 1 },
      ups: [
        { name: 'Rousing Speech', cost: 300, desc: '+40 aura radius', apply: (s) => { s.range += 40; } },
        { name: 'Summary Execution', cost: 900, desc: 'Nearby defenders fire 25% faster', apply: (s) => { s.buffRate = 0.75; } },
        { name: 'Vox-Auspex Link', cost: 700, desc: 'Nearby defenders see camouflaged spores', apply: (s) => { s.buffCamo = true; } },
        { name: 'Lord Commissar', cost: 2500, desc: 'Nearby defenders +1 damage, +12% range', apply: (s) => { s.buffDmg = 1; s.buffRange = 1.12; } },
      ],
    },
  };
  const TOWER_KEYS = Object.keys(TOWERS);
  const TARGET_MODES = ['first', 'last', 'strong', 'close'];

  // -------------------------------------------------------------------- waves
  // [tier, count, spacing in ticks, veiled?]
  const EARLY_WAVES = {
    1: [[0, 20, 32]],
    2: [[0, 32, 22]],
    3: [[0, 20, 16], [1, 6, 40]],
    4: [[1, 18, 24], [0, 20, 12]],
    5: [[1, 28, 18]],
    6: [[2, 10, 34], [1, 16, 18], [0, 20, 8]],
    7: [[2, 22, 22], [1, 20, 12]],
    8: [[3, 8, 36], [2, 18, 16]],
    9: [[3, 22, 20], [1, 30, 8]],
    10: [[4, 10, 30], [3, 18, 18], [2, 20, 10]],
    11: [[5, 6, 50], [4, 18, 18]],
    12: [[6, 6, 50], [5, 8, 40], [3, 20, 12]],
    13: [[7, 3, 80], [4, 30, 12]],
    14: [[2, 20, 14, 1], [5, 10, 30], [6, 10, 30]],
    15: [[7, 8, 50], [4, 30, 10], [1, 30, 8, 1]],
  };

  function waveGroups(n) {
    if (EARLY_WAVES[n]) return EARLY_WAVES[n];
    const rng = mulberry32(n * 7919 + 13);
    const budget = 260 * Math.pow(1.11, n - 15);
    const maxT = Math.min(8, 3 + Math.floor(n / 4));
    const groupCount = 2 + Math.floor(rng() * 3);
    const groups = [];
    for (let i = 0; i < groupCount; i++) {
      const t = clamp(maxT - Math.floor(rng() * 4), 0, 8);
      const count = clamp(Math.round(budget / groupCount / TIERS[t].rbe), 1, 90);
      let spacing = (8 + rng() * 24) * (t >= 7 ? 2 : 1);
      spacing *= Math.max(0.4, 1 - (n - 15) * 0.012);
      const veiled = n >= 18 && t < 8 && rng() < 0.22 ? 1 : 0;
      groups.push([t, count, Math.round(spacing), veiled]);
    }
    if (n >= 25 && n % 5 === 0) {
      const bosses = n <= FINAL_WAVE ? 1 + Math.floor((n - 25) / 10) : Math.floor((n - 20) / 5);
      groups.push([9, bosses, 420, 0]);
    }
    return groups;
  }

  function buildSchedule(n) {
    const out = [];
    let start = 0;
    for (const [tier, count, spacing, veiled] of waveGroups(n)) {
      for (let i = 0; i < count; i++) out.push({ at: start + i * spacing, tier, veiled: !!veiled });
      start += Math.max(60, count * spacing * 0.6);
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // -------------------------------------------------------------------- state
  let state;
  let nextId = 1;
  function newState() {
    return {
      money: START_MONEY,
      lives: START_LIVES,
      wave: 0,
      waveActive: false,
      queue: [],
      waveTick: 0,
      time: 0,
      speed: 1,
      paused: false,
      auto: false,
      autoTimer: 0,
      over: false,
      won: false,
      freeplay: false,
      warnedVeil: false,
      enemies: [],
      towers: [],
      projectiles: [],
      shells: [],
      fx: [],
      particles: [],
      floats: [],
    };
  }
  let selected = null; // selected tower
  let placing = null; // tower type key being placed
  let hover = { x: -999, y: -999, inside: false };

  // -------------------------------------------------------------------- audio
  let actx = null, muted = false, lastPopSfx = 0, lastClang = 0;
  function ensureAudio() {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
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
    pop() { const now = performance.now(); if (now - lastPopSfx < 35) return; lastPopSfx = now; tone(rand(420, 820), 0.07, 'triangle', 0.05, 0.45); },
    clang() { const now = performance.now(); if (now - lastClang < 120) return; lastClang = now; tone(180, 0.09, 'square', 0.025, 1.4); },
    boom() { noise(0.35, 0.22, 380); },
    zap() { tone(1400, 0.16, 'sawtooth', 0.025, 0.15); },
    arc() { noise(0.12, 0.08, 3000); },
    leak() { tone(120, 0.45, 'sawtooth', 0.06, 0.5); },
    place() { tone(260, 0.12, 'square', 0.04, 1.6); },
    horn() { tone(98, 0.6, 'sawtooth', 0.05, 1.02); tone(147, 0.6, 'sawtooth', 0.03, 1.02); },
  };

  // ------------------------------------------------------------------ effects
  function burst(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(0.5, spd);
      state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(14, 26), max: 26, color, size: rand(1.5, 3.2) });
    }
  }
  function floatText(x, y, text, color) {
    if (state.floats.length > 40) return;
    state.floats.push({ x, y, text, color, life: 40 });
  }

  // ------------------------------------------------------------------ enemies
  function spawnEnemy(tier, d, veiled) {
    const t = TIERS[tier];
    const hpMul = state.wave >= FINAL_WAVE ? 1 + (state.wave - FINAL_WAVE) * 0.1 : 1;
    const hp = t.hp > 1 ? Math.round(t.hp * hpMul) : 1;
    const p = posAt(d);
    const e = { id: nextId++, tier, d, veiled, hp, maxHp: hp, x: p.x, y: p.y, ang: p.ang, alive: true, wob: Math.random() * 6 };
    state.enemies.push(e);
    return e;
  }
  function enemySpeed(e) {
    const mul = state.wave >= FINAL_WAVE ? 1 + (state.wave - FINAL_WAVE) * 0.02 : 1;
    return TIERS[e.tier].speed * SPEED_BASE * mul;
  }

  // Returns false if the hit was absorbed (armour or immunity) — the projectile stops.
  function damage(e, dmg, dtype, src, hitSet) {
    if (!e.alive) return true;
    const t = TIERS[e.tier];
    if (t.armored && !src.stats.ap) {
      sfx.clang();
      if (Math.random() < 0.3) floatText(e.x, e.y - 14, 'CLANG', '#b9b9b9');
      return false;
    }
    if (t.immune && t.immune.includes(dtype)) {
      if (Math.random() < 0.3) floatText(e.x, e.y - 14, 'IMMUNE', '#d7c6ff');
      return false;
    }
    e.hp -= dmg;
    if (e.hp > 0) {
      burst(e.x, e.y, t.color, 2, 1.5);
      return true;
    }
    const overflow = -e.hp;
    e.alive = false;
    state.money += t.reward || 1;
    src.pops += 1;
    burst(e.x, e.y, t.color, t.boss ? 60 : 8, t.boss ? 5 : 2.6);
    sfx.pop();
    if (t.boss) { sfx.boom(); floatText(e.x, e.y, 'BIO-TITAN SLAIN', '#f0c96a'); }
    const kids = t.kids.map((k, i) => spawnEnemy(k, e.d - i * 9, e.veiled));
    if (hitSet) for (const k of kids) hitSet.add(k.id);
    if (overflow > 0 && kids.length) damage(kids[0], overflow, dtype, src, hitSet);
    return true;
  }

  // ------------------------------------------------------------------- towers
  function buildStats(tw) {
    const def = TOWERS[tw.type];
    const s = Object.assign({ ap: false, camo: false }, def.base);
    for (let i = 0; i < tw.level; i++) def.ups[i].apply(s);
    tw.stats = s;
  }
  function placeTower(type, x, y) {
    const def = TOWERS[type];
    const tw = { id: nextId++, type, x, y, level: 0, spent: def.cost, cd: 10, angle: -Math.PI / 2, pops: 0, mode: 'first', buff: null, flash: 0 };
    buildStats(tw);
    state.towers.push(tw);
    state.money -= def.cost;
    sfx.place();
    burst(x, y, '#c9a24a', 10, 2);
    return tw;
  }
  function canPlace(type, x, y) {
    const r = TOWERS[type].r;
    if (x < r || y < r || x > W - r || y > H - r) return false;
    if (distToPath(x, y) < PATH_W / 2 + r - 4) return false;
    for (const t of state.towers) if (Math.hypot(t.x - x, t.y - y) < r + TOWERS[t.type].r) return false;
    return true;
  }

  function computeBuffs() {
    const coms = state.towers.filter((t) => t.type === 'commissar');
    for (const t of state.towers) {
      const b = { rateMul: 1, dmg: 0, camo: false, rangeMul: 1 };
      for (const c of coms) {
        if (c === t) continue;
        if (Math.hypot(c.x - t.x, c.y - t.y) > c.stats.range) continue;
        b.rateMul = Math.min(b.rateMul, c.stats.buffRate);
        b.dmg = Math.max(b.dmg, c.stats.buffDmg);
        b.camo = b.camo || c.stats.buffCamo;
        b.rangeMul = Math.max(b.rangeMul, c.stats.buffRange);
      }
      t.buff = b;
    }
  }
  function eff(t) {
    const s = t.stats, b = t.buff || { rateMul: 1, dmg: 0, camo: false, rangeMul: 1 };
    return { range: s.range * b.rangeMul, rate: s.rate * b.rateMul, dmg: (s.dmg || 0) + b.dmg, camo: s.camo || b.camo };
  }

  function findTarget(t, range, camo) {
    let best = null, bestScore = -Infinity;
    for (const e of state.enemies) {
      if (!e.alive || e.d < 0) continue;
      if (e.veiled && !camo) continue;
      const dist = Math.hypot(e.x - t.x, e.y - t.y);
      if (dist > range + TIERS[e.tier].r * 0.5) continue;
      let score;
      switch (t.mode) {
        case 'last': score = -e.d; break;
        case 'strong': score = TIERS[e.tier].rbe * 1000 + e.hp * 10 + e.d / 1000; break;
        case 'close': score = -dist; break;
        default: score = e.d;
      }
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  function predict(e, ticks) {
    return posAt(e.d + enemySpeed(e) * ticks);
  }

  function fire(t, target, ef) {
    const s = t.stats;
    t.flash = 6;
    switch (s.kind) {
      case 'proj': {
        let p = predict(target, Math.hypot(target.x - t.x, target.y - t.y) / s.speed);
        p = predict(target, Math.hypot(p.x - t.x, p.y - t.y) / s.speed);
        const base = Math.atan2(p.y - t.y, p.x - t.x);
        t.angle = base;
        for (let i = 0; i < s.count; i++) {
          const off = s.count > 1 ? (i - (s.count - 1) / 2) * s.spread : rand(-s.spread, s.spread);
          const a = base + off;
          state.projectiles.push({
            x: t.x + Math.cos(a) * 14, y: t.y + Math.sin(a) * 14,
            vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed,
            dmg: ef.dmg, pierce: s.pierce, dtype: s.dtype, src: t,
            life: (ef.range * 1.5) / s.speed, hit: new Set(), color: s.projColor, kind: s.dtype,
          });
        }
        break;
      }
      case 'flame': {
        const a = Math.atan2(target.y - t.y, target.x - t.x);
        t.angle = a;
        const hits = state.enemies
          .filter((e) => e.alive && e.d >= 0 && (!e.veiled || ef.camo))
          .map((e) => ({ e, dist: Math.hypot(e.x - t.x, e.y - t.y) }))
          .filter(({ e, dist }) => dist <= ef.range + TIERS[e.tier].r && Math.abs(angleDiff(Math.atan2(e.y - t.y, e.x - t.x), a)) <= s.cone)
          .sort((p, q) => p.dist - q.dist)
          .slice(0, s.pierce);
        const hitSet = new Set();
        for (const { e } of hits) if (!hitSet.has(e.id)) { hitSet.add(e.id); damage(e, ef.dmg, s.dtype, t, hitSet); }
        for (let i = 0; i < 16; i++) {
          const aa = a + rand(-s.cone, s.cone) * 0.8, v = rand(2.5, 4.5);
          state.particles.push({ x: t.x + Math.cos(a) * 12, y: t.y + Math.sin(a) * 12, vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, life: ef.range / v, max: ef.range / v, color: Math.random() < 0.5 ? '#ffb030' : '#ff5a1a', size: rand(3, 6), flame: true });
        }
        break;
      }
      case 'shell': {
        const p = predict(target, s.flight);
        t.angle = Math.atan2(p.y - t.y, p.x - t.x);
        state.shells.push({ sx: t.x, sy: t.y, tx: p.x, ty: p.y, t: 0, dur: s.flight, src: t, dmg: ef.dmg });
        noise(0.12, 0.08, 900);
        break;
      }
      case 'beam': {
        const a = Math.atan2(target.y - t.y, target.x - t.x);
        t.angle = a;
        const ex = t.x + Math.cos(a) * ef.range, ey = t.y + Math.sin(a) * ef.range;
        const hitSet = new Set([target.id]);
        damage(target, ef.dmg, s.dtype, t, hitSet);
        let endX = target.x, endY = target.y;
        if (s.pierce > 1) {
          endX = ex; endY = ey;
          const others = state.enemies
            .filter((e) => e.alive && !hitSet.has(e.id) && e.d >= 0 && segDist(e.x, e.y, t.x, t.y, ex, ey) < TIERS[e.tier].r + 6)
            .sort((p, q) => Math.hypot(p.x - t.x, p.y - t.y) - Math.hypot(q.x - t.x, q.y - t.y))
            .slice(0, s.pierce - 1);
          for (const e of others) if (!hitSet.has(e.id)) { hitSet.add(e.id); damage(e, ef.dmg, s.dtype, t, hitSet); }
        }
        state.fx.push({ type: 'beam', x1: t.x + Math.cos(a) * 16, y1: t.y + Math.sin(a) * 16, x2: endX, y2: endY, life: 14, max: 14, width: s.pierce > 1 ? 7 : 4 });
        sfx.zap();
        break;
      }
      case 'chain': {
        const hitSet = new Set();
        const pts = [[t.x, t.y - 10]];
        let cur = target;
        for (let i = 0; i < s.chain && cur; i++) {
          hitSet.add(cur.id);
          pts.push([cur.x, cur.y]);
          const from = cur;
          damage(cur, ef.dmg, s.dtype, t, hitSet);
          let next = null, nd = 95;
          for (const e of state.enemies) {
            if (!e.alive || hitSet.has(e.id) || e.d < 0) continue;
            const dd = Math.hypot(e.x - from.x, e.y - from.y);
            if (dd < nd) { nd = dd; next = e; }
          }
          cur = next;
        }
        t.angle = Math.atan2(target.y - t.y, target.x - t.x);
        state.fx.push({ type: 'arc', pts, life: 12, max: 12 });
        sfx.arc();
        break;
      }
    }
  }

  function explode(sh) {
    const s = sh.src.stats;
    state.fx.push({ type: 'boom', x: sh.tx, y: sh.ty, r: s.splash, life: 18, max: 18 });
    burst(sh.tx, sh.ty, '#ffb347', 14, 3.5);
    sfx.boom();
    const hits = state.enemies
      .filter((e) => e.alive && e.d >= 0)
      .map((e) => ({ e, dist: Math.hypot(e.x - sh.tx, e.y - sh.ty) }))
      .filter(({ e, dist }) => dist <= s.splash + TIERS[e.tier].r)
      .sort((p, q) => p.dist - q.dist)
      .slice(0, s.pierce);
    const hitSet = new Set();
    for (const { e } of hits) if (!hitSet.has(e.id)) { hitSet.add(e.id); damage(e, sh.dmg, s.dtype, sh.src, hitSet); }
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
    if (!state.warnedVeil && state.queue.some((q) => q.veiled)) {
      state.warnedVeil = true;
      toast('Camouflaged spores incoming. Only Psykers and auspex-equipped defenders can see them.', 5000);
    } else if (state.queue.some((q) => TIERS[q.tier].boss)) {
      toast('A Hierophant Bio-Titan approaches the gate.', 3500);
    }
    updateHud(true);
    renderPanel();
  }

  function endWave() {
    state.waveActive = false;
    state.wave += 1;
    const bonus = 100 + state.wave * 2;
    state.money += bonus;
    floatText(W / 2, 40, `Wave ${state.wave} repelled  +${bonus}`, '#c9a24a');
    try {
      const best = Number(localStorage.getItem('bloomfall-best') || 0);
      if (state.wave > best) localStorage.setItem('bloomfall-best', String(state.wave));
    } catch (e) { /* storage unavailable */ }
    if (state.wave === FINAL_WAVE && !state.freeplay) {
      state.won = true;
      showOverlay('The Hive Holds', `The hive fleet is broken after ${FINAL_WAVE} waves, with ${state.lives} Faith remaining. The Emperor protects.`, [
        ['Keep fighting (freeplay)', () => { state.freeplay = true; hideOverlay(); }],
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

    // spawn
    if (state.waveActive) {
      state.waveTick++;
      while (state.queue.length && state.queue[0].at <= state.waveTick) {
        const q = state.queue.shift();
        spawnEnemy(q.tier, 0, q.veiled);
      }
    } else if (state.auto && (!state.won || state.freeplay)) {
      if (--state.autoTimer <= 0) startWave();
    }

    // move enemies
    for (const e of state.enemies) {
      if (!e.alive) continue;
      e.d += enemySpeed(e);
      const p = posAt(e.d);
      e.x = p.x; e.y = p.y; e.ang = p.ang;
      if (e.d >= GATE_D) {
        e.alive = false;
        state.lives -= TIERS[e.tier].rbe;
        sfx.leak();
        floatText(e.x - 20, e.y - 16, `-${TIERS[e.tier].rbe}`, '#ff6b5b');
      }
    }

    // towers
    computeBuffs();
    for (const t of state.towers) {
      if (t.flash > 0) t.flash--;
      if (t.stats.kind === 'aura') continue;
      if (t.cd > 0) { t.cd--; continue; }
      const ef = eff(t);
      const target = findTarget(t, ef.range, ef.camo);
      if (!target) continue;
      fire(t, target, ef);
      t.cd = ef.rate;
    }

    // projectiles
    for (const p of state.projectiles) {
      p.x += p.vx; p.y += p.vy; p.life--;
      if (p.life <= 0 || p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) { p.dead = true; continue; }
      for (let i = 0, n = state.enemies.length; i < n; i++) {
        const e = state.enemies[i];
        if (!e.alive || p.hit.has(e.id) || e.d < 0) continue;
        const r = TIERS[e.tier].r + 3;
        if (Math.abs(e.x - p.x) > r || Math.abs(e.y - p.y) > r * 1.2) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) > r) continue;
        p.hit.add(e.id);
        const ok = damage(e, p.dmg, p.dtype, p.src, p.hit);
        p.pierce = ok ? p.pierce - 1 : 0;
        if (p.pierce <= 0) { p.dead = true; break; }
      }
    }
    state.projectiles = state.projectiles.filter((p) => !p.dead);

    // shells
    for (const sh of state.shells) {
      sh.t++;
      if (sh.t >= sh.dur) { sh.dead = true; explode(sh); }
    }
    state.shells = state.shells.filter((s) => !s.dead);

    state.enemies = state.enemies.filter((e) => e.alive);

    // particles & fx
    for (const p of state.particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--; }
    state.particles = state.particles.filter((p) => p.life > 0);
    if (state.particles.length > 900) state.particles.splice(0, state.particles.length - 900);
    for (const f of state.fx) f.life--;
    state.fx = state.fx.filter((f) => f.life > 0);
    for (const f of state.floats) { f.life--; f.y -= 0.5; }
    state.floats = state.floats.filter((f) => f.life > 0);

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
    // ash ground
    const g = c.createRadialGradient(W * 0.5, H * 0.5, 100, W * 0.5, H * 0.5, 650);
    g.addColorStop(0, '#3a332b');
    g.addColorStop(1, '#1d1915');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,240,210,0.05)';
      c.fillRect(rng() * W, rng() * H, rng() * 3 + 1, rng() * 3 + 1);
    }
    // craters
    for (let i = 0; i < 18; i++) {
      const x = rng() * W, y = rng() * H, r = 10 + rng() * 26;
      if (distToPath(x, y) < r + PATH_W / 2) continue;
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath(); c.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(160,140,110,0.18)'; c.lineWidth = 3;
      c.beginPath(); c.ellipse(x, y - 2, r, r * 0.7, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
    }
    // ruined walls
    for (let i = 0; i < 14; i++) {
      const x = rng() * W, y = rng() * H;
      if (distToPath(x, y) < 50) continue;
      const n = 2 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) {
        const w = 6 + rng() * 22, h = 5 + rng() * 9;
        const bx = x + k * 9 + rng() * 6, by = y + rng() * 8;
        c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(bx + 3, by + 3, w, h);
        c.fillStyle = shade('#5b544b', Math.floor(rng() * 30 - 15)); c.fillRect(bx, by, w, h);
        c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(bx, by, w, 2);
      }
    }
    // Tyranid bio-creep spreading from the spawning pool
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 0.9 - Math.PI * 0.45, dist = Math.pow(rng(), 1.6) * 330;
      const x = Math.cos(a) * dist, y = 90 + Math.sin(a) * dist * 1.1, r = 6 + rng() * 22 * (1 - dist / 400);
      c.fillStyle = `rgba(${90 + rng() * 40 | 0},${20 + rng() * 20 | 0},${80 + rng() * 40 | 0},${0.25 + rng() * 0.25})`;
      c.beginPath(); c.ellipse(x, y, r, r * 0.7, rng() * 3, 0, Math.PI * 2); c.fill();
    }
    // road
    const trace = () => { c.beginPath(); PATH_PTS.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); };
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = '#120f0c'; c.lineWidth = PATH_W + 12; trace(); c.stroke();
    c.strokeStyle = '#4a4339'; c.lineWidth = PATH_W; trace(); c.stroke();
    c.strokeStyle = '#564e43'; c.lineWidth = PATH_W - 14; trace(); c.stroke();
    c.setLineDash([14, 18]); c.strokeStyle = 'rgba(201,162,74,0.22)'; c.lineWidth = 3; trace(); c.stroke();
    c.setLineDash([]);
    // flagstone seams along the road
    for (let d = 0; d < PATH_LEN; d += 26) {
      const p = posAt(d), nx = -Math.sin(p.ang), ny = Math.cos(p.ang);
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(p.x + nx * (PATH_W / 2 - 2), p.y + ny * (PATH_W / 2 - 2)); c.lineTo(p.x - nx * (PATH_W / 2 - 2), p.y - ny * (PATH_W / 2 - 2)); c.stroke();
    }
    // vignette
    const v = c.createRadialGradient(W / 2, H / 2, 280, W / 2, H / 2, 640);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }

  // ------------------------------------------------------------ spore sprites
  const SPR_SCALE = 2;
  const sprites = TIERS.map((t, i) => (t.boss ? null : makeBloomSprite(i)));
  function makeBloomSprite(i) {
    const t = TIERS[i], r = t.r;
    const w = Math.ceil(r * 3.4 + 6), h = Math.ceil(r * 3.6 + 8);
    const cv = document.createElement('canvas');
    cv.width = w * SPR_SCALE; cv.height = h * SPR_SCALE;
    const c = cv.getContext('2d');
    c.scale(SPR_SCALE, SPR_SCALE);
    const x = w / 2, y = r * 1.6 + 4;
    const CHITIN = i === 7 ? '#d9cfb4' : '#3b1f4a';
    // gargoyle wings sit behind the body
    if (i === 3) {
      c.fillStyle = '#5a2a5e';
      for (const sd of [-1, 1]) {
        c.beginPath(); c.moveTo(x + sd * r * 0.5, y - r * 0.4);
        c.lineTo(x + sd * r * 1.65, y - r * 0.9); c.lineTo(x + sd * r * 1.45, y - r * 0.1);
        c.lineTo(x + sd * r * 1.6, y + r * 0.35); c.lineTo(x + sd * r * 0.6, y + r * 0.2); c.fill();
      }
    }
    // dangling feeder tendrils
    c.strokeStyle = shade(t.color, -70); c.lineWidth = 1.4; c.lineCap = 'round';
    for (const k of [-0.45, 0, 0.45]) {
      c.beginPath(); c.moveTo(x + k * r, y + r * 0.9);
      c.quadraticCurveTo(x + k * r * 1.5 + 3, y + r * 1.45, x + k * r * 1.1 - 1, y + r * 2.05); c.stroke();
    }
    // fleshy sac
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.2, r * 0.1, x, y, r * 1.25);
    g.addColorStop(0, shade(t.color, 60)); g.addColorStop(0.55, t.color); g.addColorStop(1, shade(t.color, -55));
    c.fillStyle = g;
    c.beginPath(); c.ellipse(x, y, r, r * 1.15, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1; c.stroke();
    // veins
    c.strokeStyle = 'rgba(60,10,30,0.35)'; c.lineWidth = 0.8;
    for (const k of [-0.5, 0.15, 0.6]) {
      c.beginPath(); c.moveTo(x + k * r, y + r * 0.95); c.quadraticCurveTo(x + k * r * 0.4 + 2, y + r * 0.3, x + k * r * 0.7, y - r * 0.1); c.stroke();
    }
    // chitin carapace cap with plate seams
    const a0 = Math.PI * 1.06, a1 = Math.PI * 1.94;
    c.fillStyle = CHITIN;
    c.beginPath();
    c.ellipse(x, y, r * 1.04, r * 1.2, 0, a0, a1);
    c.quadraticCurveTo(x, y - r * 0.05, x + Math.cos(a0) * r * 1.04, y + Math.sin(a0) * r * 1.2);
    c.fill();
    c.strokeStyle = i === 7 ? 'rgba(90,70,50,0.7)' : 'rgba(150,100,170,0.6)'; c.lineWidth = 1;
    for (const k of [-0.35, 0.35]) { c.beginPath(); c.moveTo(x + k * r, y - r * 0.32); c.lineTo(x + k * r * 0.8, y - r * 1.05); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath(); c.ellipse(x - r * 0.35, y - r * 0.8, r * 0.28, r * 0.12, -0.3, 0, Math.PI * 2); c.fill();
    // per-organism details
    c.save();
    c.translate(x, y);
    const eyes = (col, sz) => {
      c.fillStyle = col;
      c.beginPath(); c.arc(-r * 0.28, -r * 0.12, sz, 0, Math.PI * 2); c.arc(r * 0.28, -r * 0.12, sz, 0, Math.PI * 2); c.fill();
    };
    const claws = (col, n) => {
      c.strokeStyle = col; c.lineWidth = 1.6; c.lineCap = 'round';
      for (let k = 0; k < n; k++) for (const sd of [-1, 1]) {
        const yy = r * (0.05 + k * 0.4);
        c.beginPath(); c.moveTo(sd * r * 0.9, yy); c.quadraticCurveTo(sd * r * 1.5, yy - r * 0.3, sd * r * 1.35, yy + r * 0.35); c.stroke();
      }
    };
    switch (i) {
      case 0: { // spore mine spines
        c.strokeStyle = '#3b1f4a'; c.lineWidth = 1.5;
        for (const a of [0.15, 0.5, 0.85]) { const an = a * Math.PI; c.beginPath(); c.moveTo(Math.cos(an) * r, Math.sin(an) * r); c.lineTo(Math.cos(an) * r * 1.35, Math.sin(an) * r * 1.35); c.stroke(); }
        break;
      }
      case 1: eyes('#ffd54a', 1.6); break;
      case 2: { // acid sacs + scything claws
        eyes('#ffd54a', 1.4);
        c.fillStyle = 'rgba(180,230,60,0.75)';
        [[-0.3, 0.45], [0.3, 0.45], [0, 0.7]].forEach(([a, b]) => { c.beginPath(); c.arc(a * r, b * r, r * 0.13, 0, Math.PI * 2); c.fill(); });
        claws('#e8dcc0', 1);
        break;
      }
      case 3: eyes('#ff6b3b', 1.5); break;
      case 4: { // four-armed genestealer
        eyes('#ffe36b', 1.6);
        claws('#2a1236', 2);
        break;
      }
      case 5: { // zoanthrope: swollen brain + warp glow
        c.strokeStyle = 'rgba(170,255,140,0.55)'; c.lineWidth = 1;
        for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(0, -r * 0.55, r * (0.25 + k * 0.18), Math.PI * 1.1, Math.PI * 1.9); c.stroke(); }
        eyes('#9dff7a', 1.8);
        break;
      }
      case 6: { // pyrovore flame vents
        c.fillStyle = '#ff8a2a';
        [[-0.4, 0.3], [0, 0.55], [0.4, 0.3]].forEach(([a, b]) => { c.beginPath(); c.arc(a * r, b * r, r * 0.14, 0, Math.PI * 2); c.fill(); });
        eyes('#3b1f4a', 1.4);
        break;
      }
      case 7: { // carnifex: bone plates, tusks, scything talons
        c.strokeStyle = 'rgba(70,55,40,0.8)'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(-r * 0.95, r * 0.3); c.quadraticCurveTo(0, r * 0.5, r * 0.95, r * 0.3); c.stroke();
        c.fillStyle = '#efe6cf';
        for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(sd * r * 0.25, r * 0.05); c.lineTo(sd * r * 0.12, r * 0.05); c.lineTo(sd * r * 0.32, r * 0.55); c.fill(); }
        eyes('#ff4b2b', 1.6);
        claws('#d9cfb4', 1);
        break;
      }
      case 8: { // tervigon: crest spines + brood sacs full of gaunts
        c.fillStyle = '#3b1f4a';
        for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(k * r * 0.3 - 2.5, -r * 1.0); c.lineTo(k * r * 0.33, -r * 1.55 + Math.abs(k) * r * 0.15); c.lineTo(k * r * 0.3 + 2.5, -r * 1.0); c.fill(); }
        c.fillStyle = 'rgba(240,200,210,0.55)';
        [[-0.45, 0.35], [0.05, 0.6], [0.5, 0.3]].forEach(([a, b]) => { c.beginPath(); c.ellipse(a * r, b * r, r * 0.22, r * 0.17, 0, 0, Math.PI * 2); c.fill(); });
        c.fillStyle = '#3a6fc4';
        [[-0.45, 0.35], [0.05, 0.6], [0.5, 0.3]].forEach(([a, b]) => { c.beginPath(); c.arc(a * r, b * r, r * 0.08, 0, Math.PI * 2); c.fill(); });
        eyes('#ffd54a', 1.7);
        break;
      }
    }
    c.restore();
    // highlight
    c.fillStyle = 'rgba(255,255,255,0.32)';
    c.beginPath(); c.ellipse(x - r * 0.5, y + r * 0.2, r * 0.14, r * 0.26, -0.3, 0, Math.PI * 2); c.fill();
    return { cv, w, h, ox: x, oy: y };
  }

  // ------------------------------------------------------------------ drawing
  function drawBloom(c, e) {
    const t = TIERS[e.tier];
    const bob = Math.sin(state.time * 0.12 + e.wob) * 1.3;
    if (t.boss) return drawTitan(c, e);
    const s = sprites[e.tier];
    c.save();
    if (e.veiled) c.globalAlpha = 0.55;
    c.drawImage(s.cv, e.x - s.ox, e.y - s.oy + bob, s.w, s.h);
    c.restore();
    if (e.veiled) {
      c.save();
      c.strokeStyle = 'rgba(160,210,120,0.75)'; c.lineWidth = 1.5; c.setLineDash([3, 4]);
      c.lineDashOffset = -state.time * 0.5;
      c.beginPath(); c.arc(e.x, e.y + bob, t.r + 4, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
    if (t.hp > 1 && e.hp < e.maxHp) {
      // cracks
      const k = 1 - e.hp / e.maxHp;
      c.strokeStyle = 'rgba(20,8,4,0.8)'; c.lineWidth = 1.2;
      const rng = mulberry32(e.id);
      for (let i = 0; i < Math.ceil(k * 5); i++) {
        const a = rng() * Math.PI * 2;
        c.beginPath(); c.moveTo(e.x, e.y + bob);
        c.lineTo(e.x + Math.cos(a) * t.r * 0.5, e.y + bob + Math.sin(a) * t.r * 0.5 + 2);
        c.lineTo(e.x + Math.cos(a + 0.3) * t.r * 0.9, e.y + bob + Math.sin(a + 0.3) * t.r * 0.9);
        c.stroke();
      }
    }
  }

  function drawTitan(c, e) {
    const t = TIERS[e.tier], r = t.r;
    c.save();
    c.translate(e.x, e.y + Math.sin(state.time * 0.05) * 2);
    c.rotate(e.ang);
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(6, 10, r * 1.5, r * 0.8, 0, 0, Math.PI * 2); c.fill();
    // six striding legs
    const step = state.time * 0.12;
    c.strokeStyle = '#d9cfb4'; c.lineWidth = 4; c.lineCap = 'round';
    for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) {
      const bx = (k - 1) * r * 0.8, sw = Math.sin(step + k * 2 + (sd > 0 ? Math.PI : 0)) * r * 0.3;
      c.beginPath(); c.moveTo(bx, sd * r * 0.5);
      c.lineTo(bx + sw * 0.5, sd * r * 1.25); c.lineTo(bx + sw + r * 0.15, sd * r * 1.6); c.stroke();
    }
    // fleshy body
    const g = c.createRadialGradient(-r * 0.4, -r * 0.3, 4, 0, 0, r * 1.6);
    g.addColorStop(0, '#c26a8a'); g.addColorStop(0.6, '#8a3a5c'); g.addColorStop(1, '#2a0c22');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(0, 0, r * 1.5, r * 0.85, 0, 0, Math.PI * 2); c.fill();
    // bone carapace plates down the spine
    for (let k = -2; k <= 1; k++) {
      c.fillStyle = '#d9cfb4';
      c.beginPath(); c.ellipse(k * r * 0.55, 0, r * 0.36, r * 0.62, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#4b1460';
      c.beginPath(); c.ellipse(k * r * 0.55, 0, r * 0.24, r * 0.48, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#d9cfb4';
      c.beginPath(); c.moveTo(k * r * 0.55 - 3, -r * 0.1); c.lineTo(k * r * 0.55 - r * 0.25, -r * 0.05); c.lineTo(k * r * 0.55 - 3, r * 0.1); c.fill();
    }
    // head with scything talons
    c.fillStyle = '#d9cfb4';
    c.beginPath(); c.ellipse(r * 1.35, 0, r * 0.45, r * 0.4, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#4b1460';
    c.beginPath(); c.ellipse(r * 1.3, 0, r * 0.3, r * 0.26, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffe36b';
    c.beginPath(); c.arc(r * 1.5, -r * 0.14, 2.6, 0, Math.PI * 2); c.arc(r * 1.5, r * 0.14, 2.6, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#efe6cf'; c.lineWidth = 3;
    for (const sd of [-1, 1]) {
      c.beginPath(); c.moveTo(r * 1.2, sd * r * 0.35);
      c.quadraticCurveTo(r * 1.9, sd * r * 0.9, r * 2.1, sd * r * 0.3); c.stroke();
    }
    c.restore();
    // hp bar
    const bw = 70, k = e.hp / e.maxHp;
    c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(e.x - bw / 2, e.y - r - 22, bw, 7);
    c.fillStyle = '#b25ad6'; c.fillRect(e.x - bw / 2 + 1, e.y - r - 21, (bw - 2) * k, 5);
  }

  function drawTower(c, type, x, y, angle, level, flash, scale) {
    const def = TOWERS[type];
    const r = def.r * (scale || 1);
    c.save();
    c.translate(x, y);
    // base shadow + plinth
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.beginPath(); c.ellipse(3, 4, r + 2, r * 0.9 + 2, 0, 0, Math.PI * 2); c.fill();
    switch (type) {
      case 'guard': {
        c.fillStyle = '#6e6346';
        c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#3b3424'; c.lineWidth = 2; c.stroke();
        // sandbags
        c.fillStyle = '#8c7f5c';
        for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; c.beginPath(); c.ellipse(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, 4 * (scale || 1), 3 * (scale || 1), a + Math.PI / 2, 0, Math.PI * 2); c.fill(); }
        c.rotate(angle);
        const s = scale || 1;
        for (const [ox, oy] of [[-3, -5], [-3, 5], [3, 0]]) {
          c.strokeStyle = '#2b2b2b'; c.lineWidth = 2 * s;
          c.beginPath(); c.moveTo(ox * s, oy * s); c.lineTo((ox + 11) * s, oy * s); c.stroke();
          c.fillStyle = def.color; c.beginPath(); c.arc(ox * s, oy * s, 3.6 * s, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#3d3f22'; c.beginPath(); c.arc(ox * s - 0.6, oy * s, 2.2 * s, 0, Math.PI * 2); c.fill();
        }
        if (flash > 3) { c.fillStyle = '#ff8a5a'; c.beginPath(); c.arc(14 * s, 0, 3 * s, 0, Math.PI * 2); c.fill(); }
        break;
      }
      case 'bolter': {
        const s = scale || 1;
        c.fillStyle = '#5a4f3a'; c.fillRect(-r, -r, r * 2, r * 2);
        c.strokeStyle = '#2b251b'; c.lineWidth = 2; c.strokeRect(-r, -r, r * 2, r * 2);
        c.fillStyle = '#7c6f50';
        for (let k = -1; k <= 1; k++) { c.fillRect(-r + 2, k * 8 * s - 3 * s, 6 * s, 6 * s); c.fillRect(r - 8 * s, k * 8 * s - 3 * s, 6 * s, 6 * s); }
        c.rotate(angle);
        c.fillStyle = def.color; c.beginPath(); c.arc(0, 0, 7 * s, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#1e1e1e'; c.fillRect(2 * s, -3 * s, 18 * s, 6 * s);
        c.fillStyle = '#3a3a3a'; c.fillRect(16 * s, -4 * s, 5 * s, 8 * s);
        if (flash > 0) { c.fillStyle = flash % 2 ? '#ffe08a' : '#ff9a3a'; c.beginPath(); c.arc(23 * s, 0, 4 * s, 0, Math.PI * 2); c.fill(); }
        break;
      }
      case 'flamer': {
        const s = scale || 1;
        c.rotate(angle);
        c.strokeStyle = '#2a2a24'; c.lineWidth = 3 * s;
        c.beginPath(); c.moveTo(-6 * s, -11 * s); c.lineTo(-12 * s, -16 * s); c.moveTo(-6 * s, 11 * s); c.lineTo(-12 * s, 16 * s); c.stroke();
        c.fillStyle = def.color;
        c.beginPath(); c.roundRect(-11 * s, -10 * s, 20 * s, 20 * s, 4 * s); c.fill();
        c.strokeStyle = '#33332a'; c.lineWidth = 1.5; c.stroke();
        c.fillStyle = '#c9a24a'; c.fillRect(-9 * s, -2 * s, 6 * s, 4 * s);
        c.fillStyle = '#3a3a3a'; c.fillRect(8 * s, -3 * s, 12 * s, 6 * s);
        c.fillStyle = flash > 0 ? '#ffb030' : '#7a2a10'; c.beginPath(); c.arc(20 * s, 0, 3 * s, 0, Math.PI * 2); c.fill();
        break;
      }
      case 'mortar': {
        const s = scale || 1;
        c.fillStyle = '#2a241c'; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#7c6f50';
        for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; c.beginPath(); c.ellipse(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, 4.5 * s, 3.2 * s, a + Math.PI / 2, 0, Math.PI * 2); c.fill(); }
        c.rotate(angle);
        c.fillStyle = '#4a4436'; c.beginPath(); c.arc(0, 0, 6 * s, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#1c1c1c'; c.fillRect(-2 * s, -4 * s, 13 * s, 8 * s);
        c.fillStyle = flash > 0 ? '#ff9a3a' : '#000'; c.beginPath(); c.arc(11 * s, 0, 3.6 * s, 0, Math.PI * 2); c.fill();
        break;
      }
      case 'lascannon': {
        const s = scale || 1;
        c.fillStyle = '#3c3a36';
        c.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        c.closePath(); c.fill();
        c.strokeStyle = '#1e1d1b'; c.lineWidth = 2; c.stroke();
        c.rotate(angle);
        c.fillStyle = def.color; c.beginPath(); c.arc(0, 0, 7 * s, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#20252c'; c.fillRect(0, -2.5 * s, 26 * s, 5 * s);
        c.fillStyle = '#8a8f96'; c.fillRect(6 * s, -3.5 * s, 4 * s, 7 * s);
        c.fillStyle = flash > 0 ? '#e9fbff' : '#4fb6ff'; c.beginPath(); c.arc(26 * s, 0, 2.6 * s, 0, Math.PI * 2); c.fill();
        break;
      }
      case 'psyker': {
        const s = scale || 1;
        const glow = c.createRadialGradient(0, 0, 2, 0, 0, r * 1.4);
        glow.addColorStop(0, flash > 0 ? 'rgba(170,220,255,0.9)' : 'rgba(110,150,255,0.5)'); glow.addColorStop(1, 'rgba(110,150,255,0)');
        c.fillStyle = glow; c.beginPath(); c.arc(0, 0, r * 1.4, 0, Math.PI * 2); c.fill();
        c.fillStyle = def.color; c.beginPath(); c.arc(0, 0, r * 0.8, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#1d244a'; c.beginPath(); c.arc(0, 0, r * 0.45, 0, Math.PI * 2); c.fill();
        c.rotate(angle);
        c.strokeStyle = '#c9a24a'; c.lineWidth = 2 * s;
        c.beginPath(); c.moveTo(-4 * s, 6 * s); c.lineTo(14 * s, 6 * s); c.stroke();
        c.fillStyle = '#9fd4ff'; c.beginPath(); c.arc(14 * s, 6 * s, 2.5 * s, 0, Math.PI * 2); c.fill();
        break;
      }
      case 'commissar': {
        const s = scale || 1;
        c.fillStyle = '#4a1a16'; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = def.color; c.beginPath(); c.arc(0, 0, r * 0.75, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#a3221b'; c.fillRect(-r * 0.75, -2 * s, r * 1.5, 4 * s);
        c.fillStyle = '#111'; c.beginPath(); c.arc(0, 0, 6 * s, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#c9a24a'; c.beginPath(); c.arc(0, -2 * s, 2 * s, 0, Math.PI * 2); c.fill();
        // banner pole
        c.strokeStyle = '#c9a24a'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(r * 0.6, r * 0.2); c.lineTo(r * 0.6, -r * 1.3); c.stroke();
        c.fillStyle = '#a3221b'; c.beginPath(); c.moveTo(r * 0.6, -r * 1.3); c.lineTo(r * 1.4, -r * 1.1); c.lineTo(r * 0.6, -r * 0.8); c.fill();
        break;
      }
    }
    c.restore();
    // level pips
    if (level > 0) {
      for (let i = 0; i < level; i++) {
        c.fillStyle = '#c9a24a';
        c.fillRect(x - 10 + i * 6, y + r + 3, 4, 3);
      }
    }
  }

  function drawRift(c) {
    // Tyranid spawning pool: a pulsing pit of biomass that disgorges spores.
    const x = 8, y = 90, t = state.time * 0.04;
    c.save();
    const pulse = 1 + Math.sin(t * 2) * 0.04;
    const g = c.createRadialGradient(x, y, 4, x, y, 62 * pulse);
    g.addColorStop(0, '#f0a0c0'); g.addColorStop(0.35, '#a03a6a'); g.addColorStop(0.75, '#4b1460'); g.addColorStop(1, 'rgba(40,10,40,0)');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(x, y, 52 * pulse, 60 * pulse, 0, 0, Math.PI * 2); c.fill();
    // waving tendrils
    c.strokeStyle = '#3b1f4a'; c.lineCap = 'round';
    for (let k = 0; k < 7; k++) {
      const a = -1.3 + k * 0.43, sw = Math.sin(t * 3 + k) * 0.25;
      c.lineWidth = 4 - k % 3;
      c.beginPath(); c.moveTo(x + Math.cos(a) * 30, y + Math.sin(a) * 34);
      c.quadraticCurveTo(x + Math.cos(a + sw) * 52, y + Math.sin(a + sw) * 58, x + Math.cos(a - sw) * 66, y + Math.sin(a - sw) * 70);
      c.stroke();
    }
    // bubbling spore sacs
    c.fillStyle = 'rgba(255,200,220,0.5)';
    for (let k = 0; k < 5; k++) {
      const ph = (t * 0.8 + k * 0.21) % 1;
      c.beginPath(); c.arc(x + 4 + Math.sin(k * 7) * 16, y + Math.cos(k * 5) * 22, 2 + ph * 4, 0, Math.PI * 2); c.fill();
    }
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
    // battlements
    c.fillStyle = '#4a4339';
    for (let k = 0; k < 4; k++) { c.fillRect(x - 4 + k * 15, y - 70, 9, 10); c.fillRect(x - 4 + k * 15, y + 60, 9, 10); }
    // skull-and-wings motif
    c.fillStyle = '#c9a24a';
    c.beginPath(); c.arc(x + 24, y - 42, 5, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(x + 19, y - 42); c.lineTo(x + 4, y - 48); c.lineTo(x + 10, y - 40); c.fill();
    c.beginPath(); c.moveTo(x + 29, y - 42); c.lineTo(x + 44, y - 48); c.lineTo(x + 38, y - 40); c.fill();
    c.restore();
  }

  function render() {
    const c = ctx;
    c.drawImage(bg, 0, 0, W, H);
    drawRift(c);

    // aura / range for selected tower
    if (selected) {
      const ef = eff(selected);
      c.save();
      c.fillStyle = selected.type === 'commissar' ? 'rgba(163,34,27,0.12)' : 'rgba(201,162,74,0.10)';
      c.strokeStyle = 'rgba(201,162,74,0.6)'; c.lineWidth = 1.5; c.setLineDash([6, 6]);
      c.beginPath(); c.arc(selected.x, selected.y, ef.range, 0, Math.PI * 2); c.fill(); c.stroke();
      c.restore();
    }

    // shadows beneath spores
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (const e of state.enemies) {
      if (TIERS[e.tier].boss) continue;
      c.beginPath(); c.ellipse(e.x + 5, e.y + 14, TIERS[e.tier].r * 0.7, 3.5, 0, 0, Math.PI * 2); c.fill();
    }
    // spores, nearest to the gate drawn last
    const order = state.enemies.slice().sort((a, b) => a.d - b.d);
    for (const e of order) drawBloom(c, e);

    drawGate(c);

    for (const t of state.towers) drawTower(c, t.type, t.x, t.y, t.angle, t.level, t.flash);
    if (selected) {
      c.strokeStyle = '#c9a24a'; c.lineWidth = 2;
      c.beginPath(); c.arc(selected.x, selected.y, TOWERS[selected.type].r + 5, 0, Math.PI * 2); c.stroke();
    }

    // projectiles
    for (const p of state.projectiles) {
      c.strokeStyle = p.color; c.lineWidth = p.kind === 'bolt' ? 3 : 2;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 1.2, p.y - p.vy * 1.2); c.stroke();
    }
    // shells (arc in flight)
    for (const sh of state.shells) {
      const k = sh.t / sh.dur;
      const x = sh.sx + (sh.tx - sh.sx) * k, y = sh.sy + (sh.ty - sh.sy) * k - Math.sin(k * Math.PI) * 70;
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.beginPath(); c.arc(sh.sx + (sh.tx - sh.sx) * k, sh.sy + (sh.ty - sh.sy) * k, 3, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2b2b2b'; c.beginPath(); c.arc(x, y, 4 + Math.sin(k * Math.PI) * 2, 0, Math.PI * 2); c.fill();
    }

    // fx
    for (const f of state.fx) {
      const k = f.life / f.max;
      if (f.type === 'beam') {
        c.save();
        c.globalAlpha = k;
        c.strokeStyle = '#4fb6ff'; c.lineWidth = f.width * 2;
        c.beginPath(); c.moveTo(f.x1, f.y1); c.lineTo(f.x2, f.y2); c.stroke();
        c.strokeStyle = '#effcff'; c.lineWidth = f.width * 0.6;
        c.beginPath(); c.moveTo(f.x1, f.y1); c.lineTo(f.x2, f.y2); c.stroke();
        c.restore();
      } else if (f.type === 'boom') {
        c.save();
        c.globalAlpha = k * 0.8;
        const g = c.createRadialGradient(f.x, f.y, 2, f.x, f.y, f.r);
        g.addColorStop(0, '#fff2b0'); g.addColorStop(0.4, '#ff9a3a'); g.addColorStop(1, 'rgba(120,30,10,0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(f.x, f.y, f.r * (1.2 - k * 0.4), 0, Math.PI * 2); c.fill();
        c.restore();
      } else if (f.type === 'arc') {
        c.save();
        c.globalAlpha = k;
        for (const [col, w] of [['#6f8cff', 5], ['#e6f2ff', 1.6]]) {
          c.strokeStyle = col; c.lineWidth = w;
          c.beginPath();
          const rng = mulberry32(Math.floor(state.time / 3) + f.pts.length);
          f.pts.forEach(([x, y], i) => {
            if (!i) { c.moveTo(x, y); return; }
            const [px, py] = f.pts[i - 1];
            for (let s = 1; s <= 3; s++) {
              const kk = s / 4;
              c.lineTo(px + (x - px) * kk + (rng() - 0.5) * 14, py + (y - py) * kk + (rng() - 0.5) * 14);
            }
            c.lineTo(x, y);
          });
          c.stroke();
        }
        c.restore();
      }
    }

    // particles
    for (const p of state.particles) {
      const k = p.life / p.max;
      c.globalAlpha = Math.max(0, Math.min(1, k * 1.4));
      c.fillStyle = p.color;
      if (p.flame) { c.beginPath(); c.arc(p.x, p.y, p.size * (1.4 - k * 0.6), 0, Math.PI * 2); c.fill(); }
      else c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;

    // placement ghost
    if (placing && hover.inside) {
      const def = TOWERS[placing];
      const ok = canPlace(placing, hover.x, hover.y) && state.money >= def.cost;
      c.save();
      c.fillStyle = ok ? 'rgba(143,220,132,0.12)' : 'rgba(255,80,60,0.15)';
      c.strokeStyle = ok ? 'rgba(143,220,132,0.7)' : 'rgba(255,80,60,0.7)';
      c.setLineDash([5, 5]); c.lineWidth = 1.5;
      c.beginPath(); c.arc(hover.x, hover.y, def.base.range, 0, Math.PI * 2); c.fill(); c.stroke();
      c.restore();
      c.globalAlpha = 0.75;
      drawTower(c, placing, hover.x, hover.y, -Math.PI / 2, 0, 0);
      c.globalAlpha = 1;
    }

    // floating text
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
    $('faithBox').classList.toggle('low', state.lives < 40);
    const startBtn = $('startBtn');
    const dis = state.waveActive || state.over || (state.won && !state.freeplay);
    if (startBtn.disabled !== dis) startBtn.disabled = dis;
    for (const b of document.querySelectorAll('.shop-btn')) {
      const poor = state.money < TOWERS[b.dataset.type].cost;
      if (b.classList.contains('poor') !== poor) b.classList.toggle('poor', poor);
      b.classList.toggle('active', placing === b.dataset.type);
    }
  }

  function buildShop() {
    const shop = $('shop');
    for (const key of TOWER_KEYS) {
      const def = TOWERS[key];
      const b = document.createElement('button');
      b.className = 'shop-btn';
      b.dataset.type = key;
      b.title = `${def.name}: ${def.blurb}`;
      const icon = document.createElement('canvas');
      icon.width = 68; icon.height = 68;
      const ic = icon.getContext('2d');
      ic.scale(2, 2);
      drawTower(ic, key, 17, 18, -Math.PI / 4, 0, 0, 0.85);
      const txt = document.createElement('span');
      txt.innerHTML = `<span class="nm"></span><span class="cost"></span>`;
      txt.querySelector('.nm').textContent = def.name;
      txt.querySelector('.cost').textContent = `⚙ ${def.cost}`;
      const hk = document.createElement('span');
      hk.className = 'hk'; hk.textContent = def.key;
      b.append(icon, txt, hk);
      b.addEventListener('click', () => beginPlace(key));
      shop.appendChild(b);
    }
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

  function renderPanel() {
    const p = $('panel');
    if (selected) {
      const t = selected, def = TOWERS[t.type], s = t.stats, ef = eff(t);
      const next = def.ups[t.level];
      const rows = [];
      if (s.kind === 'aura') {
        rows.push(['Aura radius', Math.round(s.range)]);
        rows.push(['Fire-rate bonus', `+${Math.round((1 / s.buffRate - 1) * 100)}%`]);
        if (s.buffDmg) rows.push(['Damage bonus', `+${s.buffDmg}`]);
      } else {
        rows.push(['Range', Math.round(ef.range)]);
        rows.push(['Shots / sec', (60 / ef.rate).toFixed(2)]);
        rows.push(['Damage', ef.dmg]);
        if (s.kind === 'chain') rows.push(['Arcs', s.chain]);
        else if (s.kind === 'shell') rows.push(['Blast radius', s.splash]);
        else rows.push(['Pierce', s.pierce * (s.count || 1)]);
        rows.push(['Pops', `<span id="pTop">${t.pops}</span>`]);
      }
      const tags = s.kind === 'aura'
        ? [['Grants auspex sight', s.buffCamo]]
        : [['Sees camouflaged', ef.camo], ['Pierces armour', s.ap]];
      p.innerHTML = `
        <h2>${esc(def.name)}</h2>
        <p class="sub">${esc(def.blurb)}</p>
        <div class="pips">${def.ups.map((_, i) => `<span class="pip${i < t.level ? ' on' : ''}"></span>`).join('')}</div>
        <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        <div class="tags">${tags.map(([k, v]) => `<span class="tag${v ? ' yes' : ''}">${k}</span>`).join('')}</div>
        ${next ? `<button class="upgrade" id="upBtn"><span class="u-name">${esc(next.name)} <kbd>U</kbd></span><span class="u-desc">${esc(next.desc)}</span><span class="u-cost">⚙ ${next.cost}</span></button>`
          : '<p class="muted">Fully upgraded.</p>'}
        <div class="row">
          ${s.kind !== 'aura' ? `<button id="modeBtn">Target: ${t.mode}<kbd>T</kbd></button>` : ''}
          <button id="sellBtn">Sell ⚙ ${Math.floor(t.spent * 0.7)}<kbd>S</kbd></button>
        </div>`;
      const up = $('upBtn');
      if (up) { up.disabled = state.money < next.cost; up.addEventListener('click', upgradeSelected); }
      const mb = $('modeBtn');
      if (mb) mb.addEventListener('click', cycleMode);
      $('sellBtn').addEventListener('click', sellSelected);
      return;
    }
    if (placing) {
      const def = TOWERS[placing];
      p.innerHTML = `<h2>${esc(def.name)}</h2><p class="sub">${esc(def.blurb)}</p>
        <p>Click open ground to deploy for <b>⚙ ${def.cost}</b>. Hold Shift to deploy several. Esc cancels.</p>
        <p class="muted">Upgrades: ${def.ups.map((u) => esc(u.name)).join(' → ')}</p>`;
      return;
    }
    // Augury: preview of the next wave
    const n = state.wave + 1;
    const counts = new Map();
    if (!(state.won && !state.freeplay)) {
      for (const [tier, count, , veiled] of waveGroups(n)) {
        const key = `${tier}:${veiled ? 1 : 0}`;
        counts.set(key, (counts.get(key) || 0) + count);
      }
    }
    const items = [...counts.entries()]
      .map(([k, c]) => { const [tier, v] = k.split(':').map(Number); return { tier, v, c }; })
      .sort((a, b) => b.tier - a.tier);
    p.innerHTML = `<h2>Augury</h2>
      <p class="sub">${state.waveActive ? `Wave ${n} in progress.` : `The auspex detects wave ${n}:`}</p>
      <ul class="augury">${items.map(({ tier, v, c }) => `<li><span class="dot" style="background:${TIERS[tier].color}"></span>
        <span>${esc(TIERS[tier].name)} ${v ? '<span class="veil">camouflaged</span>' : ''}${TIERS[tier].note ? `<br><span class="muted" style="font-size:.75rem">${esc(TIERS[tier].note)}</span>` : ''}</span>
        <span class="cnt">×${c}</span></li>`).join('')}</ul>`;
  }

  function refreshPanelLive() {
    if (!selected) return;
    const pt = $('pTop');
    if (pt) pt.textContent = selected.pops;
    const up = $('upBtn');
    const next = TOWERS[selected.type].ups[selected.level];
    if (up && next) up.disabled = state.money < next.cost;
  }

  function upgradeSelected() {
    if (!selected) return;
    const def = TOWERS[selected.type];
    const next = def.ups[selected.level];
    if (!next) return;
    if (state.money < next.cost) { toast('Not enough requisition.'); return; }
    state.money -= next.cost;
    selected.spent += next.cost;
    selected.level++;
    buildStats(selected);
    sfx.place();
    burst(selected.x, selected.y, '#c9a24a', 14, 2.5);
    renderPanel();
    updateHud();
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
    if (!selected || selected.stats.kind === 'aura') return;
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
  canvas.addEventListener('pointermove', (ev) => {
    const p = toBoard(ev);
    hover = { x: p.x, y: p.y, inside: true };
  });
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
      const tw = placeTower(placing, p.x, p.y);
      if (!ev.shiftKey || state.money < def.cost) { placing = null; selected = tw; }
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
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
    ensureAudio();
    const k = ev.key.toLowerCase();
    const tower = TOWER_KEYS.find((t) => TOWERS[t].key === k);
    if (tower) { beginPlace(tower); return; }
    if (k === ' ') { ev.preventDefault(); startWave(); }
    else if (k === 'escape') { placing = null; selected = null; renderPanel(); updateHud(); }
    else if (k === 'u') upgradeSelected();
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
  fitCanvas();
  buildShop();
  renderPanel();
  updateHud(true);
  requestAnimationFrame(loop);

  // Exposed for debugging and automated tests.
  window.bloomfall = {
    get state() { return state; }, TIERS, TOWERS, placeTower, canPlace, startWave, tick, waveGroups,
  };
})();
