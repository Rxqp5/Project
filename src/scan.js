// Reading a Pokémon GO screenshot of a Pokémon's page: text recognition (in the browser, with
// Tesseract.js), then working out the species, CP, HP, moves, level and IVs from the text.
// Everything except `readScreenshot` is a pure function, shared by the app and the tests.

import { cpmAt, cpAt, MAX_LEVEL } from './collection.js';

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

export function parseScreen(text) {
  const raw = text.replace(/\r/g, '');
  const lines = raw.split('\n').map(clean).filter(Boolean);
  const flat = lines.join(' ');

  // "CP 3200" / "CP3,200". The small raised "CP" is often read as "cp", "cr" or "cf", and the big
  // thin digits are easy to misread, so every reading is kept and checked against HP and stardust
  // later (see pickCp).
  const cpReadings = [...new Set([...raw.matchAll(/\bC\s?[PFRO]\s*(\d[\d,.]{1,6})/gi)]
    .map((m) => String(toNumber(m[1]))).filter((r) => r.length >= 2 && r.length <= 5))];
  const cp = cpReadings.length ? Number(cpReadings[0]) : null;

  // "152 / 152 HP"
  const hpMatch = /(\d{1,3})\s*\/\s*(\d{1,3})\s*HP/i.exec(raw);
  const hp = hpMatch ? Number(hpMatch[2]) : null;

  // "POWER UP  9,000  12": stardust then candy.
  const dustMatch = /POWER\s*UP\D{0,12}?(\d{1,2}[,.]?\d{3}|\d{3})\D{1,12}?(\d{1,2})\b/i.exec(raw.replace(/\n/g, ' '));
  const stardust = dustMatch ? toNumber(dustMatch[1]) : null;

  // "LARVITAR CANDY" (but not "XL CANDY")
  const candyMatch = /([A-Z][A-Z' .-]{2,}?)\s+CANDY\b/.exec(flat.replace(/\bXL\s+CANDY\b/g, ''));
  const family = candyMatch ? candyMatch[1].trim().split(' ').pop() : null;

  return {
    lines,
    cpReadings,
    cp: cp && cp >= 10 && cp <= 10000 ? cp : null,
    hp: hp && hp >= 10 ? hp : null,
    stardust,
    family,
    shadow: /\bPURIFY\b/.test(flat),
    lucky: /\bLUCKY\b/.test(flat),
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

export const hpAt = (p, cpm, sta) => Math.max(10, Math.floor((p.sta + sta) * cpm));

// Every (level, IVs) that gives exactly this CP, HP and stardust cost. Purified Pokémon have
// cheaper power-ups and nothing on screen to say so, so both costs are accepted.
export function solveLevelAndIvs(data, p, { cp, hp, stardust, shadow, lucky }) {
  const matches = [];
  for (let level = 1; level <= MAX_LEVEL; level += 0.5) {
    if (stardust) {
      const costs = [powerUpDust(data, level, { shadow, lucky }), powerUpDust(data, level, { purified: true, lucky })];
      if (!costs.includes(stardust)) continue;
    }
    const m = cpmAt(data, level);
    for (let sta = 0; sta <= 15; sta++) {
      if (hp && hpAt(p, m, sta) !== hp) continue;
      for (let atk = 0; atk <= 15; atk++) {
        for (let def = 0; def <= 15; def++) {
          if (cpAt(p, m, { atk, def, sta }) === cp) matches.push({ level, atk, def, sta });
        }
      }
    }
  }
  return matches;
}

// Every CP this Pokémon can have with this HP and power-up cost.
export function possibleCps(data, p, { hp, stardust, shadow, lucky }) {
  const cps = new Set();
  for (let level = 1; level <= MAX_LEVEL; level += 0.5) {
    if (stardust) {
      const costs = [powerUpDust(data, level, { shadow, lucky }), powerUpDust(data, level, { purified: true, lucky })];
      if (!costs.includes(stardust)) continue;
    }
    const m = cpmAt(data, level);
    for (let sta = 0; sta <= 15; sta++) {
      if (hp && hpAt(p, m, sta) !== hp) continue;
      for (let atk = 0; atk <= 15; atk++) {
        for (let def = 0; def <= 15; def++) cps.add(cpAt(p, m, { atk, def, sta }));
      }
    }
  }
  return cps;
}

// The possible CP that best agrees with what was read. The CP is read several times, so each
// possible CP gets a vote from every reading: 2 for an exact match, 1 for one wrong digit.
// `distance` is how far the best-agreeing reading was from it.
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
      else if (d === 1 && r.length === cs.length) votes += 1;
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

function movesOnScreen(parsed, p, data) {
  const score = (ids) => ids
    .map((id) => ({ id, s: bestLineMatch(parsed.lines, clean(data.moves[id].name)) }))
    .filter((m) => m.s >= MOVE_THRESHOLD)
    .sort((a, b) => b.s - a.s);
  return { fast: score([...p.fast, ...p.eliteFast]), charged: score([...p.charged, ...p.eliteCharged]) };
}

// Picks the species (and form) that best fits the screenshot: its name, its candy family, the
// moves on screen, and whether its stats can produce that CP and HP at all.
export function identify(parsed, data) {
  const results = [];
  const family = parsed.family && clean(parsed.family);
  for (const [key, p] of Object.entries(data.pokemon)) {
    if (!p.released || p.mega || p.gmax || !p.fast.length) continue;
    const name = clean(p.name.replace(/\s*\(.*\)$/, ''));
    const nameScore = bestLineMatch(parsed.lines, name);
    const familyMatch = family && p.family && similarity(family, clean(p.family)) >= 0.8;
    if (nameScore < 0.8 && !familyMatch) continue;
    const moves = movesOnScreen(parsed, p, data);
    let score = (nameScore >= 0.8 ? 4 + nameScore : 0) + (familyMatch ? 3 : 0)
      + (moves.fast.length ? 2 : 0) + Math.min(2, moves.charged.length) * 2;
    // Regional forms: prefer the form whose types/moves fit; a plain name match favours the base form.
    if (/\(/.test(p.name) && !moves.fast.length && !moves.charged.length) score -= 1;
    // The CP must be one this Pokémon can have with the HP and power-up cost shown.
    let cp = null;
    if (parsed.cpReadings?.length && (parsed.hp || parsed.stardust)) {
      const pick = pickCp(parsed.cpReadings, possibleCps(data, p, parsed));
      cp = pick?.cp ?? null;
      score += pick ? Math.min(3, pick.votes) : -6;
    } else if (parsed.cp) {
      score += solveLevelAndIvs(data, p, { cp: parsed.cp }).length ? 2 : -6;
      cp = parsed.cp;
    }
    results.push({ key, score, moves, cp });
  }
  results.sort((a, b) => b.score - a.score);
  return results[0] && results[0].score > 2 ? results[0] : null;
}

// Everything the app needs to add the Pokémon, plus what it wasn't sure about.
export function readPokemon(parsed, data) {
  const id = identify(parsed, data);
  if (!id) return { parsed, key: null, problems: ["Couldn't tell which Pokémon this is."] };
  const p = data.pokemon[id.key];
  const problems = [];
  const fast = id.moves.fast[0]?.id || null;
  const charged = id.moves.charged.slice(0, 2).map((m) => m.id);
  if (!fast) problems.push('Fast move not found; pick it below.');
  if (!charged.length) problems.push('Charged move not found; pick it below.');
  const cp = id.cp;
  if (!cp) problems.push('CP not found; enter it below.');
  else if (!parsed.stardust) problems.push('Power-up cost not found, so the level is an estimate.');
  const solved = cp
    ? summarizeMatches(solveLevelAndIvs(data, p, { ...parsed, cp })) || summarizeMatches(solveLevelAndIvs(data, p, { cp }))
    : null;
  return {
    parsed,
    key: id.key,
    cp,
    hp: parsed.hp,
    fast,
    charged,
    shadow: parsed.shadow && p.shadow,
    dynamax: parsed.dynamax && Boolean(p.dynamax),
    gmax: parsed.gmax && Boolean(data.pokemon[`${id.key}_GIGANTAMAX`]),
    level: solved?.level ?? null,
    ivs: solved?.exact ? solved.ivs : null,
    ivGuess: solved?.ivs ?? null,
    levelRange: solved?.levels,
    problems,
  };
}

// Moves often sit below the fold, so one Pokémon can take two screenshots: one with the CP and
// one with the moves. A screenshot with no CP is merged into the previous one.
export function mergeScreens(parsedList) {
  const merged = [];
  for (const s of parsedList) {
    const prev = merged[merged.length - 1];
    if (prev && !s.cp && (!s.hp || s.hp === prev.hp)) {
      prev.lines = [...prev.lines, ...s.lines];
      prev.cpReadings = [...prev.cpReadings, ...s.cpReadings];
      for (const k of ['family', 'stardust']) prev[k] = prev[k] || s[k];
      for (const k of ['shadow', 'lucky', 'dynamax', 'gmax']) prev[k] = prev[k] || s[k];
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
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

// Pokémon GO mixes dark text on light panels with white text on artwork, so the image is read
// as a high-contrast greyscale image, inverted, and (for the CP at the top) the top quarter with
// only its near-white pixels kept, as black on white, at full and half size. Enlarging the image
// makes the thin CP digits misread, so it's only ever shrunk (to phone-screenshot width).
async function preparedImages(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1290 / bitmap.width);
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale),
  });
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const grey = new Uint8ClampedArray(img.data.length / 4);
  for (let i = 0; i < grey.length; i++) {
    const v = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
    grey[i] = Math.max(0, Math.min(255, (v - 128) * 1.6 + 128));
  }
  const render = (invert) => {
    const out = g.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < grey.length; i++) {
      const v = invert ? 255 - grey[i] : grey[i];
      out.data.set([v, v, v, 255], i * 4);
    }
    g.putImageData(out, 0, 0);
    return canvas.toDataURL('image/png');
  };
  const top = Math.round(canvas.height * 0.25);
  const whiteText = g.createImageData(canvas.width, top);
  for (let i = 0; i < canvas.width * top; i++) {
    const [r, gr, b] = img.data.subarray(i * 4, i * 4 + 3);
    const white = Math.min(r, gr, b) > 225 && Math.max(r, gr, b) - Math.min(r, gr, b) < 30;
    whiteText.data.set(white ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  }
  const passes = [render(false), render(true)];
  canvas.height = top;
  g.putImageData(whiteText, 0, 0);
  passes.push(canvas.toDataURL('image/png'));
  const half = Object.assign(document.createElement('canvas'), { width: Math.round(canvas.width / 2), height: Math.round(top / 2) });
  half.getContext('2d').drawImage(canvas, 0, 0, half.width, half.height);
  passes.push(half.toDataURL('image/png'));
  return passes;
}

// Reads one screenshot and returns its parsed text.
export async function readScreenshot(file) {
  const worker = await getWorker();
  const texts = [];
  for (const image of await preparedImages(file)) {
    const { data } = await worker.recognize(image);
    texts.push(data.text);
  }
  return parseScreen(texts.join('\n'));
}
