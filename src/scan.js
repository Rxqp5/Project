// Reading a Pokémon GO screenshot of a Pokémon's page: text recognition (in the browser, with
// Tesseract.js), then working out the species, CP, HP, moves, level and IVs from the text.
// Everything except `readScreenshot` is a pure function, shared by the app and the tests.

import { cpmAt, cpAt, MAX_LEVEL, estimateLevel } from './collection.js';
import { bestMovesetsOverall } from './calc.js';

// ---------- Text helpers ----------

const clean = (s) => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// 0–1: how closely `text` matches `target` (both already cleaned).
export function similarity(text, target) {
  if (!text || !target) return 0;
  if (text === target) return 1;
  return 1 - levenshtein(text, target) / Math.max(text.length, target.length);
}

// Best similarity of `target` against any line, or any run of words inside a line
// ("BITE 12" still matches "BITE", "SHADOW BALL 100" matches "SHADOW BALL").
function bestLineMatch(lines, target) {
  const words = target.split(' ').length;
  let best = 0;
  for (const line of lines) {
    const parts = line.split(' ');
    for (let i = 0; i < parts.length; i++) {
      for (let n = Math.max(1, words - 1); n <= words + 1 && i + n <= parts.length; n++) {
        best = Math.max(best, similarity(parts.slice(i, i + n).join(' '), target));
      }
    }
  }
  return best;
}

const toNumber = (s) => Number(String(s).replace(/[^0-9]/g, ''));

// ---------- Parsing the text of one screenshot ----------

const TYPE_WORDS = new Set(['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL',
  'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK', 'FAIRY']);
// A line that's only type names ("PSYCHIC", "FAIRY STEEL") is the type label, not a move.
const isTypeLine = (line) => line.split(' ').every((w) => TYPE_WORDS.has(w));

// `bandText` is the text read from the cropped CP area at the top (just the CP digits).
export function parseScreen(text, bandText = '') {
  const raw = text.replace(/\r/g, '').replace(/\+/g, ' PLUS ');
  const lines = raw.split('\n').map(clean).filter(Boolean);
  const flat = lines.join(' ');

  // "CP 3200" / "CP3,200". The small raised "CP" is often read as "cp", "cr" or "cf", and the big
  // thin digits are easy to misread or partly hidden, so every reading is kept and checked against
  // HP and stardust later (see pickCp).
  const readings = [...raw.matchAll(/\bC\s?[PFRO]\s*[’']?\s*(\d[\d,.]{1,6})/gi), ...raw.matchAll(/\bP(\d{3,4})\b/g)]
    .map((m) => String(toNumber(m[1])));
  for (const m of bandText.matchAll(/\d[\d,.]{1,6}/g)) readings.push(String(toNumber(m[0])));
  const cpReadings = [...new Set(readings.filter((r) => r.length >= 2 && r.length <= 5))];
  const cp = cpReadings.length ? Number(cpReadings[0]) : null;

  // "152 / 152 HP"
  const hpMatch = /(\d{1,3})\s*\/\s*(\d{1,3})\s*HP/i.exec(raw);
  const hp = hpMatch ? Number(hpMatch[2]) : null;

  // Power-up cost: "POWER UP 9,000 12". The button's white label often isn't read, so every
  // "stardust candy" pair of numbers is kept; the level solver uses the ones that fit the cost table
  // (the Purify cost of a Shadow Pokémon looks the same, and is ruled out by the CP and HP).
  const labelled = /POWER\s*UP\D{0,12}?(\d{1,2}[,.]?\d{3}|\d{3})\D{1,12}?(\d{1,2})\b/i.exec(raw.replace(/\n/g, ' '));
  const powerUps = [...raw.matchAll(/(?:^|[^\d,.])(\d{1,2}[,.]\d{3}|\d{3})[^\S\n]*[^\d\n]{0,4}?[^\S\n](\d{1,2})(?![\d,.])/gm)]
    .map((m) => ({ stardust: toNumber(m[1]), candy: Number(m[2]) }));
  const stardust = labelled ? toNumber(labelled[1]) : null;

  // "LARVITAR CANDY" (but not "XL CANDY")
  const candyMatch = /([A-Z][A-Z' .-]{2,}?)\s+CANDY\b/.exec(flat.replace(/\b(XL|BONUS|RARE)\s+CANDY\b/g, ''));
  const family = candyMatch ? candyMatch[1].trim().split(' ').pop() : null;
  const types = [...new Set(lines.filter(isTypeLine).flatMap((l) => l.split(' ')))];

  return {
    lines,
    cpReadings,
    cp: cp && cp >= 10 && cp <= 10000 ? cp : null,
    hp: hp && hp >= 10 ? hp : null,
    stardust,
    powerUps,
    family,
    types,
    shadow: /\bPURIFY\b|\bSHADOW BONUS\b/.test(flat),
    lucky: /\bLUCKY\b/.test(flat),
    // A Mega Evolution that's active shows a countdown ("07:36 left").
    megaActive: /\b\d{1,2} ?[:.]? ?\d{2} LEFT\b/.test(flat),
    canMega: /\bMEGA EVOLVE\b/.test(flat),
    // The game doesn't label shinies on this page, but players often tag them "SHINY".
    shiny: /\bSHINY\b/.test(flat),
    dynamax: /\bMAX (MOVES|ATTACK|GUARD|SPIRIT)\b|\bDYNAMAX\b/.test(flat),
    gmax: /\bG ?MAX\b|\bGIGANTAMAX\b/.test(flat),
  };
}

// ---------- Level and IVs ----------

// Stardust to power up once from `level`, or null at the level cap.
export function powerUpDust(data, level, { shadow = false, purified = false, lucky = false } = {}) {
  const base = data.powerUp.stardust[Math.floor(level) - 1];
  if (!base) return null;
  let m = 1;
  if (shadow) m *= data.powerUp.shadow;
  if (purified) m *= data.powerUp.purified;
  if (lucky) m *= data.powerUp.lucky;
  return Math.round(base * m);
}

// Candy (or, from level 40, XL Candy) to power up once from `level`.
export function powerUpCandy(data, level, { shadow = false, purified = false } = {}) {
  const pu = data.powerUp;
  const base = level < pu.xlFromLevel ? pu.candy[Math.floor(level) - 1] : pu.xlCandy[Math.floor(level) - pu.xlFromLevel];
  if (!base) return null;
  return Math.ceil(base * (shadow ? pu.shadow : purified ? pu.purified : 1) - 1e-9);
}

export const hpAt = (p, cpm, sta) => Math.max(10, Math.floor((p.sta + sta) * cpm));

// Whether the power-up cost(s) read from the screen fit this level. Purified Pokémon have cheaper
// power-ups and nothing on screen to say so, so both are accepted. No cost read: any level.
function levelFits(data, level, { stardust, powerUps, shadow, lucky }) {
  const costs = powerUps?.length ? powerUps : stardust ? [{ stardust, candy: null }] : null;
  if (!costs) return true;
  return [{ shadow }, { purified: true }].some((kind) => {
    const dust = powerUpDust(data, level, { ...kind, lucky });
    const candy = powerUpCandy(data, level, kind);
    return costs.some((c) => c.stardust === dust && (c.candy === null || c.candy === candy));
  });
}

// Every (level, IVs) that gives this CP (if known), HP and power-up cost. A misread cost would
// rule everything out, so if nothing fits it tries again ignoring the candy, then the cost.
export function solveLevelAndIvs(data, p, parsed) {
  const strict = solveWith(data, p, parsed);
  if (strict.length || !(parsed.powerUps?.length || parsed.stardust)) return strict;
  const dustOnly = solveWith(data, p, { ...parsed, powerUps: parsed.powerUps?.map((c) => ({ ...c, candy: null })) });
  return dustOnly.length ? dustOnly : solveWith(data, p, { ...parsed, powerUps: null, stardust: null });
}

function solveWith(data, p, parsed) {
  const { cp, hp } = parsed;
  const matches = [];
  for (let level = 1; level <= MAX_LEVEL; level += 0.5) {
    if (!levelFits(data, level, parsed)) continue;
    const m = cpmAt(data, level);
    for (let sta = 0; sta <= 15; sta++) {
      if (hp && hpAt(p, m, sta) !== hp) continue;
      for (let atk = 0; atk <= 15; atk++) {
        for (let def = 0; def <= 15; def++) {
          if (!cp || cpAt(p, m, { atk, def, sta }) === cp) matches.push({ level, atk, def, sta });
        }
      }
    }
  }
  return matches;
}

// Every CP this Pokémon can have with this HP and power-up cost.
export function possibleCps(data, p, parsed) {
  return new Set(solveLevelAndIvs(data, p, { ...parsed, cp: null })
    .map(({ level, ...ivs }) => cpAt(p, cpmAt(data, level), ivs)));
}

// The possible CP that best agrees with what was read. The CP is read several times, so each
// possible CP gets a vote from every reading: 2 for an exact match, 1 for one wrong, missing
// or extra digit (a sword or a sparkle over a digit). `distance` is the closest reading's distance.
export function pickCp(readings, possible) {
  let best = null;
  for (const c of possible) {
    const cs = String(c);
    let votes = 0;
    let distance = Infinity;
    for (const r of readings) {
      const d = levenshtein(r, cs);
      distance = Math.min(distance, d);
      if (d === 0) votes += 2;
      else if (d === 1 && r.length >= 3) votes += 1;
    }
    if (votes && (!best || votes > best.votes || (votes === best.votes && distance < best.distance))) {
      best = { cp: c, votes, distance };
    }
  }
  return best;
}

// Turns the matches into one level (the most common) and IVs (exact if they all agree).
export function summarizeMatches(matches) {
  if (!matches.length) return null;
  const counts = new Map();
  for (const m of matches) counts.set(m.level, (counts.get(m.level) || 0) + 1);
  const level = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const atLevel = matches.filter((m) => m.level === level);
  const avg = (k) => Math.round(atLevel.reduce((s, m) => s + m[k], 0) / atLevel.length);
  const exact = atLevel.length === 1;
  return {
    level,
    ivs: { atk: avg('atk'), def: avg('def'), sta: avg('sta') },
    exact,
    possibilities: matches.length,
    levels: [...counts.keys()].sort((a, b) => a - b),
  };
}

// ---------- Which Pokémon, which moves ----------

const MOVE_THRESHOLD = 0.8;
// Internal variants ("Behemoth Blade2", "Future Sight Plus 2") and Max Moves never show as moves.
const listedMove = (m, id) => !/\d/.test(m.name) && !id.startsWith('MAX_');

// Every move whose name appears on the screen (ignoring the type label), best match first.
export function movesOnScreen(parsed, data) {
  const lines = parsed.lines.filter((l) => !isTypeLine(l));
  const found = new Map();
  for (const [id, m] of Object.entries(data.moves)) {
    if (!listedMove(m, id)) continue;
    const name = clean(m.name.replace(/\+/g, ' PLUS '));
    // "Psychic" is also a type: only count it when its power follows ("PSYCHIC 90").
    if (TYPE_WORDS.has(name) && !lines.some((l) => new RegExp(`\\b${name} \\d`).test(l))) continue;
    const s = bestLineMatch(lines, name);
    if (s >= MOVE_THRESHOLD) found.set(id, s);
  }
  return found;
}

// A species' moves, including the extra ones its Megas get (Future Sight+ for Mega Mewtwo Y).
function movePool(data, key) {
  const pool = (p) => [...p.fast, ...p.eliteFast, ...p.charged, ...p.eliteCharged];
  const ids = new Set(pool(data.pokemon[key]));
  for (const m of Object.values(data.pokemon)) if (m.base === key && m.mega) pool(m).forEach((id) => ids.add(id));
  return ids;
}

function pickMoves(found, pool, data) {
  const ranked = [...found.entries()].filter(([id]) => pool.has(id))
    // On a tie, the longer name wins ("Future Sight+" over "Future Sight").
    .sort((a, b) => b[1] - a[1] || data.moves[b[0]].name.length - data.moves[a[0]].name.length)
    .map(([id]) => id);
  return {
    fast: ranked.filter((id) => data.moves[id].kind === 'fast'),
    charged: ranked.filter((id) => data.moves[id].kind === 'charged'),
  };
}

const sameTypes = (a, b) => a.length === b.length && a.every((t) => b.includes(t.toUpperCase()));

// Picks the species (and form) that best fits the screenshot: its name, its candy family, the
// moves on screen, its types, and whether its stats can produce that CP and HP at all. A Mega
// Evolution that's active is checked against its Mega forms. A nickname with no candy shown is
// identified from its moves alone.
export function identify(parsed, data) {
  const found = movesOnScreen(parsed, data);
  const family = parsed.family && clean(parsed.family);
  const results = [];
  for (const [key, p] of Object.entries(data.pokemon)) {
    if (!p.released || p.mega || p.gmax || !p.fast.length) continue;
    const name = clean(p.name.replace(/\s*\(.*\)$/, ''));
    const nameScore = bestLineMatch(parsed.lines, name);
    const familyMatch = family && p.family && similarity(family, clean(p.family)) >= 0.8;
    const moves = pickMoves(found, movePool(data, key), data);
    const byMoves = moves.fast.length && moves.charged.length && moves.fast.length + moves.charged.length >= 3;
    if (nameScore < 0.8 && !familyMatch && !byMoves) continue;
    const forms = [key, ...(parsed.megaActive
      ? Object.keys(data.pokemon).filter((k) => data.pokemon[k].base === key && data.pokemon[k].mega) : [])];
    let best = null;
    for (const form of forms) {
      const f = data.pokemon[form];
      let score = (nameScore >= 0.8 ? 4 + nameScore : 0) + (familyMatch ? 3 : 0)
        + (moves.fast.length ? 2 : 0) + Math.min(3, moves.charged.length) * 2;
      if (/\(/.test(f.name) && !moves.fast.length && !moves.charged.length) score -= 1;
      if (parsed.types?.length) score += sameTypes(f.types, parsed.types) ? 2 : -2;
      // The CP must be one this form can have with the HP and power-up cost shown.
      let cp = null;
      if (parsed.cpReadings?.length && (parsed.hp || parsed.powerUps?.length || parsed.stardust)) {
        const pick = pickCp(parsed.cpReadings, possibleCps(data, f, parsed));
        cp = pick?.cp ?? null;
        score += pick ? Math.min(3, pick.votes) : -4;
      } else if (parsed.hp) {
        score += solveLevelAndIvs(data, f, { ...parsed, cp: null }).length ? 1 : -6;
      }
      if (!best || score > best.score) best = { key, form, score, moves, cp };
    }
    results.push(best);
  }
  results.sort((a, b) => b.score - a.score);
  return results[0] && results[0].score > 2 ? results[0] : null;
}

// Everything the app needs to add the Pokémon, plus what it wasn't sure about.
export function readPokemon(parsed, data) {
  const id = identify(parsed, data);
  if (!id) return { parsed, key: null, problems: ["Couldn't tell which Pokémon this is."] };
  const p = data.pokemon[id.key];
  const form = data.pokemon[id.form];
  const problems = [];
  const fast = id.moves.fast[0] || null;
  const charged = id.moves.charged.slice(0, 3);
  if (!fast) problems.push('Fast move not found; pick it below.');
  if (!charged.length) problems.push('Charged move not found; pick it below.');
  const cp = id.cp;
  const hasCost = parsed.powerUps?.length || parsed.stardust;
  const solved = summarizeMatches(solveLevelAndIvs(data, form, { ...parsed, cp }))
    || (cp ? summarizeMatches(solveLevelAndIvs(data, form, { cp })) : null);
  if (!cp) problems.push("CP couldn't be read (is something covering it?); enter it below.");
  else if (!hasCost && !solved?.exact) problems.push('Power-up cost not found, so the level is an estimate.');
  return {
    parsed,
    key: id.key,
    cp,
    hp: parsed.hp,
    fast,
    charged,
    shadow: parsed.shadow && p.shadow,
    mega: id.form !== id.key || Boolean(parsed.canMega),
    shiny: Boolean(parsed.shiny),
    megaActive: id.form !== id.key ? id.form : null,
    // Kept so the level and IVs can be worked out exactly once the player types a hidden CP.
    hint: { hp: parsed.hp, powerUps: parsed.powerUps, stardust: parsed.stardust, shadow: parsed.shadow, lucky: parsed.lucky },
    dynamax: parsed.dynamax && Boolean(p.dynamax),
    gmax: parsed.gmax && Boolean(data.pokemon[`${id.key}_GIGANTAMAX`]),
    level: solved?.level ?? null,
    ivs: cp && solved?.exact ? solved.ivs : null,
    ivGuess: solved?.ivs ?? null,
    levelRange: solved?.levels,
    problems,
  };
}

// Moves sit below the fold, so one Pokémon usually takes two screenshots: the top (with its HP)
// and the moves. A screenshot without an HP line is the lower half of the one before it.
export function mergeScreens(parsedList) {
  const merged = [];
  for (const s of parsedList) {
    const prev = merged[merged.length - 1];
    if (prev && !s.hp) {
      prev.lines = [...prev.lines, ...s.lines];
      prev.cpReadings = [...prev.cpReadings, ...s.cpReadings];
      prev.powerUps = [...(prev.powerUps || []), ...(s.powerUps || [])];
      prev.types = [...new Set([...(prev.types || []), ...(s.types || [])])];
      for (const k of ['family', 'stardust']) prev[k] = prev[k] || s[k];
      for (const k of ['shadow', 'lucky', 'dynamax', 'gmax', 'megaActive', 'canMega']) prev[k] = prev[k] || s[k];
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

// ---------- Storage list (the grid of all your Pokémon) ----------

// Storage screenshots show three columns of tiles: "CP 3045" above the sprite, the name (or
// nickname) below. Words come from text recognition with their positions.
export function isStorageGrid(words) {
  const text = words.map((w) => w.text.toUpperCase()).join(' ');
  // A Pokémon's own page has a POWER UP button; storage doesn't.
  if (/\bPOWER\b/.test(text)) return false;
  if (/\bPOK[EÉ]MON\b/.test(text) && /\bSEARCH\b|\bEGGS\b|\bTAGS\b/.test(text)) return true;
  return words.filter((w) => /^\d{3,4}$/.test(w.text)).length >= 6;
}

// The box of just the digits: the reader sometimes joins the small "CP" label to the number
// ("CP3045"), so the left edge is moved past any non-digit characters.
function digitBox(w) {
  const lead = (/^\D*/.exec(w.text) || [''])[0].length;
  const x0 = lead ? w.x1 - ((w.x1 - w.x0) * (w.text.length - lead)) / w.text.length : w.x0;
  return { x0, y0: w.y0, x1: w.x1, y1: w.y1 };
}

export function parseGrid(words, width) {
  const colOf = (w) => Math.min(2, Math.floor((((w.x0 + w.x1) / 2) / width) * 3));
  const tileHeight = (width / 3) * 1.35;
  const rowTolerance = width * 0.025;
  const digits = (w) => w.text.replace(/[,.]/g, '');
  let cps = words.filter((w) => /^\d{2,5}$/.test(digits(w)));
  // Real CPs line up across a row of tiles; stray numbers from sprites don't.
  if (cps.length >= 3) {
    cps = cps.filter((c) => cps.some((o) => o !== c && colOf(o) !== colOf(c) && Math.abs(o.y0 - c.y0) < rowTolerance));
  }
  // Names: words with letters, grouped per column into lines.
  const nameWords = words.filter((w) => /[A-Za-z]/.test(w.text) && !/^(CP|SEARCH|POKEMON|POKÉMON|TAGS|EGGS)$/i.test(w.text));
  const lines = [];
  for (const w of [...nameWords].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const col = colOf(w);
    const line = lines.find((l) => l.col === col && Math.abs(l.y - w.y0) < rowTolerance);
    if (line) line.words.push(w);
    else lines.push({ col, y: w.y0, words: [w] });
  }
  const firstCpY = Math.min(...cps.map((c) => c.y0));
  const tiles = [];
  for (const line of lines) {
    // Tiles cut off at the top of the screen (their CP scrolled away) are in the previous screenshot.
    if (line.y < firstCpY) continue;
    // The CP sits above the name, within one tile.
    const cp = cps
      .filter((c) => colOf(c) === line.col && c.y0 < line.y && line.y - c.y0 < tileHeight)
      .sort((a, b) => b.y0 - a.y0)[0];
    const name = line.words.sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(' ')
      .replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z0-9'’.\- ]/g, '').trim();
    if (name.length >= 2) {
      tiles.push({
        name, cpText: cp ? digits(cp) : '', col: line.col, y: line.y, offset: cp ? line.y - cp.y0 : null,
        cpBox: cp ? digitBox(cp) : null,
      });
    }
  }
  return tiles;
}

// Names sit the same distance below their CP on every tile. Lines at another distance are
// words the text reader found in sprites, so they're dropped (judged against lines that are
// clearly Pokémon names).
export function dropSpriteNoise(tiles, isName, width) {
  const known = tiles.filter((t) => t.offset !== null && isName(t.name)).map((t) => t.offset).sort((a, b) => a - b);
  if (!known.length) return tiles.filter((t) => t.offset !== null);
  const median = known[Math.floor(known.length / 2)];
  const rowY = new Set(tiles.filter((t) => isName(t.name)).map((t) => Math.round(t.y / (width * 0.05))));
  return tiles.filter((t) => (t.offset !== null ? Math.abs(t.offset - median) < width * 0.05
    : rowY.has(Math.round(t.y / (width * 0.05)))));
}

// Turns storage tiles into Pokémon. The species comes from the name when it isn't a nickname.
// The CP must be possible for that species; a CP too high for it is a Mega Evolution active right
// now. Moves aren't shown in storage, so `movesUnknown` drafts get the species' best moves.
export function readGridTiles(tiles, data, width) {
  const species = Object.entries(data.pokemon).filter(([, p]) => p.released && !p.mega && !p.gmax && p.fast.length);
  const maxCp = (p) => cpAt(p, cpmAt(data, MAX_LEVEL), { atk: 15, def: 15, sta: 15 });
  const minCp = (p) => cpAt(p, cpmAt(data, 1), { atk: 0, def: 0, sta: 0 });
  const fits = (p, cp) => cp >= minCp(p) && cp <= maxCp(p);
  // Every form of the species whose name best matches (Kyurem, Kyurem (Black), Kyurem (White)…).
  const matchSpecies = (text) => {
    const name = clean(text);
    let bestScore = 0;
    let forms = [];
    for (const [key, p] of species) {
      const score = bestLineMatch([name], clean(p.name.replace(/\s*\(.*\)$/, '')));
      if (score < 0.8 || score < bestScore) continue;
      if (score > bestScore) forms = [];
      bestScore = score;
      forms.push(key);
    }
    return forms;
  };
  const isName = (text) => matchSpecies(text).length > 0;
  return dropSpriteNoise(tiles, isName, width).map((t) => {
    let cp = Number(t.cpText) || null;
    // The shiny sparkle next to the CP is sometimes read as a leading "1" ("12686").
    const forms0 = matchSpecies(t.name);
    if (cp && t.cpText.length === 5 && t.cpText.startsWith('1') && forms0.length
      && !forms0.some((k) => fits(data.pokemon[k], cp))) cp = Number(t.cpText.slice(1));
    const draft = {
      source: 'storage', name: t.name, key: null, cp, problems: [], movesUnknown: true, fast: null, charged: [],
      shiny: Boolean(t.shiny),
    };
    const forms = matchSpecies(t.name);
    if (!forms.length) {
      draft.problems.push(`"${t.name}" looks like a nickname: pick the Pokémon.`);
      return draft;
    }
    // Prefer the plain form, unless only another form (or a Mega, Evolved right now) can have this CP.
    const plain = forms.find((k) => !data.pokemon[k].name.includes('(')) || forms[0];
    const fitting = cp ? forms.filter((k) => fits(data.pokemon[k], cp)) : forms;
    let key = fitting.includes(plain) ? plain : fitting[0];
    if (cp && !key) {
      const mega = Object.entries(data.pokemon).find(([, m]) => forms.includes(m.base) && m.mega && m.released && fits(m, cp));
      if (mega) {
        key = mega[1].base;
        draft.mega = true;
        draft.megaActive = mega[0];
      } else {
        key = plain;
        draft.cp = null;
        draft.problems.push('CP not read clearly; enter it.');
      }
    }
    if (!cp) draft.problems.push('CP not read clearly; enter it.');
    if (key !== plain && fitting.length > 1) draft.problems.push(`Check the form: it could be ${fitting.map((k) => data.pokemon[k].name).join(' or ')}.`);
    else if (key !== plain) draft.problems.push(`Its CP means it's ${data.pokemon[key].name}; check that's right.`);
    draft.key = key;
    // Storage doesn't show moves, so assume the usual raid moveset until its own page is scanned:
    // its best TM-able pair where both moves match one of its own types (or else its best pair).
    const p = data.pokemon[key];
    const sets = bestMovesetsOverall(p, data, { elite: false });
    const stab = (m) => data.moves[m.fast].type === data.moves[m.charged].type && p.types.includes(data.moves[m.fast].type);
    const best = sets.find(stab) || sets[0];
    if (best) {
      draft.fast = best.fast;
      draft.charged = [best.charged];
    }
    if (draft.cp) draft.level = estimateLevel(data, data.pokemon[draft.megaActive || key], draft.cp);
    return draft;
  });
}

// ---------- Shiny sparkle (storage) ----------

// Storage marks shinies with a small dark slate-blue sparkle (✦✦) just under the CP, on the left.
// Its colour is distinct from the grey "CP" label and from blue sprites (tested on real screenshots).
export const isSparklePixel = (r, g, b) => r >= 30 && r <= 85 && g >= 78 && g <= 112 && b >= 92 && b <= 125
  && b - g < 30 && g - r > 35;
export const SPARKLE_MIN_PIXELS = 60;

// Counts sparkle-coloured pixels in the spot under a tile's CP. `pixels` is RGBA data of an image
// `imageWidth` wide; `cpBox` is the CP number's box. Offsets are scaled from a 1290px-wide screen.
export function sparkleScore(pixels, imageWidth, imageHeight, cpBox) {
  const k = imageWidth / 1290;
  const h = cpBox.y1 - cpBox.y0;
  const x0 = Math.max(0, Math.round(cpBox.x0 - 75 * k));
  // Stop just left of the digits: they're a similar slate colour.
  const x1 = Math.min(imageWidth, Math.round(cpBox.x0 - 5 * k));
  const y0 = Math.max(0, Math.round(cpBox.y0 + 0.5 * h));
  const y1 = Math.min(imageHeight, Math.round(cpBox.y1 + 80 * k));
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * imageWidth + x) * 4;
      if (isSparklePixel(pixels[i], pixels[i + 1], pixels[i + 2])) n++;
    }
  }
  return n;
}

// ---------- Text recognition (browser only) ----------

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerPromise;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: TESSERACT_URL, async: true });
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('Could not load the text reader. Check your connection.'));
    document.head.append(s);
  });
}

function getWorker() {
  workerPromise ||= loadTesseract().then((T) => T.createWorker('eng'));
  return workerPromise;
}

// Pokémon GO mixes dark text on light panels with white text on artwork, so a screenshot is read
// several ways:
//   - "dark text": only dark grey (and red Mega CP) pixels kept, which removes the stars and
//     sparkles around CPs in storage; read with word positions to spot the storage grid;
//   - high-contrast greyscale, and inverted;
//   - the top quarter with only near-white pixels kept (the CP on a Pokémon's page), at full and
//     half size.
// Enlarging the image makes the thin CP digits misread, so it's only ever shrunk.
async function preparedImages(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1290 / bitmap.width);
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale),
  });
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const n = img.data.length / 4;
  const mono = (keep) => {
    const out = g.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < n; i++) {
      const v = keep(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
      out.data.set([v, v, v, 255], i * 4);
    }
    g.putImageData(out, 0, 0);
    return canvas.toDataURL('image/png');
  };
  const lum = (r, gr, b) => 0.299 * r + 0.587 * gr + 0.114 * b;
  const contrast = (r, gr, b) => Math.max(0, Math.min(255, (lum(r, gr, b) - 128) * 1.6 + 128));
  const darkText = mono((r, gr, b) => {
    const sat = Math.max(r, gr, b) - Math.min(r, gr, b);
    const red = r > 170 && gr < 110 && b < 110;
    return (lum(r, gr, b) < 120 && sat < 60) || red ? 0 : 255;
  });
  const grey = mono(contrast);
  const inverted = mono((r, gr, b) => 255 - contrast(r, gr, b));
  // Light grey labels ("MACHOP CANDY", "FAIRY / STEEL") vanish in the high-contrast pass.
  const labels = mono((r, gr, b) => (lum(r, gr, b) < 215 && Math.max(r, gr, b) - Math.min(r, gr, b) < 45 ? 0 : 255));
  // The CP itself: a strip across the top, keeping white (normal) and pink (Mega Evolved) text,
  // at full and half size. Real screenshots read best at half size.
  const band = [1, 0.5].map((bandScale) => {
    const y0 = Math.round(canvas.height * 0.035);
    const h = Math.round(canvas.height * 0.06);
    const x0 = Math.round(canvas.width * 0.2);
    const w = Math.round(canvas.width * 0.6);
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(w * bandScale), height: Math.round(h * bandScale) });
    const bg = c.getContext('2d', { willReadFrequently: true });
    bg.drawImage(bitmap, x0 / scale, y0 / scale, w / scale, h / scale, 0, 0, c.width, c.height);
    const d = bg.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const [r, gr, b] = d.data.subarray(i, i + 3);
      const keep = Math.min(r, gr, b) > 220 || (r > 200 && b > 110 && gr < 170 && r - gr > 60);
      d.data.set(keep ? [0, 0, 0] : [255, 255, 255], i);
    }
    bg.putImageData(d, 0, 0);
    return c.toDataURL('image/png');
  });
  const width = canvas.width;
  // White text in the top quarter only (the white card further down would turn into a black block).
  const top = Math.round(canvas.height * 0.25);
  const whiteText = g.createImageData(canvas.width, top);
  for (let i = 0; i < canvas.width * top; i++) {
    const [r, gr, b] = img.data.subarray(i * 4, i * 4 + 3);
    const white = Math.min(r, gr, b) > 225 && Math.max(r, gr, b) - Math.min(r, gr, b) < 30;
    whiteText.data.set(white ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  }
  // Tag pills under the HP ("SHINY", your own tags) are white text on colour, in a narrow middle
  // band; they read best at half size, as one block of text.
  const tagTop = Math.round(canvas.height * 0.48);
  const tagH = Math.round(canvas.height * 0.1);
  const tagText = g.createImageData(canvas.width, tagH);
  for (let i = 0; i < canvas.width * tagH; i++) {
    const [r, gr, b] = img.data.subarray((tagTop * canvas.width + i) * 4, (tagTop * canvas.width + i) * 4 + 3);
    const white = Math.min(r, gr, b) > 225 && Math.max(r, gr, b) - Math.min(r, gr, b) < 30;
    tagText.data.set(white ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  }
  canvas.height = tagH;
  g.putImageData(tagText, 0, 0);
  const tagHalf = Object.assign(document.createElement('canvas'), { width: Math.round(canvas.width / 2), height: Math.round(tagH / 2) });
  tagHalf.getContext('2d').drawImage(canvas, 0, 0, tagHalf.width, tagHalf.height);
  const tags = tagHalf.toDataURL('image/png');
  canvas.height = top;
  g.putImageData(whiteText, 0, 0);
  const cpFull = canvas.toDataURL('image/png');
  const half = Object.assign(document.createElement('canvas'), { width: Math.round(canvas.width / 2), height: Math.round(top / 2) });
  half.getContext('2d').drawImage(canvas, 0, 0, half.width, half.height);
  // The shiny sparkle test needs the screenshot's own colours (iPhones save in Display P3, which
  // the browser would otherwise convert), from a copy at the same size.
  const raw = await createImageBitmap(file, { colorSpaceConversion: 'none' });
  const rawCanvas = Object.assign(document.createElement('canvas'), { width, height: img.height });
  const rg = rawCanvas.getContext('2d', { willReadFrequently: true });
  rg.drawImage(raw, 0, 0, width, img.height);
  const pixels = rg.getImageData(0, 0, width, img.height).data;
  return { width, height: img.height, pixels, darkText, band, tags, others: [grey, inverted, labels, cpFull, half.toDataURL('image/png')] };
}

// Reads one screenshot. A storage screenshot gives { kind: 'storage', tiles, width }; a Pokémon's
// own page gives { kind: 'pokemon', parsed }.
// With `debug`, the raw text of every pass is included as `texts`.
export async function readScreenshot(file, { debug = false } = {}) {
  const worker = await getWorker();
  const { width, height, pixels, darkText, band, tags, others } = await preparedImages(file);
  const { data } = await worker.recognize(darkText, {}, { blocks: true, text: true });
  const words = (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
    .map((w) => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }));
  if (isStorageGrid(words)) {
    const tiles = parseGrid(words, width).map((t) => {
      const sparkle = t.cpBox ? sparkleScore(pixels, width, height, t.cpBox) : 0;
      return { ...t, shiny: sparkle >= SPARKLE_MIN_PIXELS, ...(debug ? { sparkle } : {}) };
    });
    return { kind: 'storage', tiles, width };
  }
  const texts = [data.text];
  for (const image of others) texts.push((await worker.recognize(image)).data.text);
  const bandTexts = [];
  for (const image of band) bandTexts.push((await worker.recognize(image)).data.text);
  await worker.setParameters({ tessedit_pageseg_mode: '6' }); // one block of text
  texts.push((await worker.recognize(tags)).data.text);
  await worker.setParameters({ tessedit_pageseg_mode: '3' }); // back to automatic
  return {
    kind: 'pokemon',
    parsed: parseScreen(texts.join('\n'), bandTexts.join('\n')),
    ...(debug ? { texts, bandTexts } : {}),
  };
}
