// "My Pokémon" page: the player's own Pokémon, entered by hand and saved on this device.

import { AVERAGE_IVS, estimateLevel, validEntries } from './collection.js';
import { readScreenshot, mergeScreens, readPokemon, readGridTiles } from './scan.js';
import { bestMovesetsOverall } from './calc.js';

const megaForms = (data, key) => Object.values(data.pokemon).filter((p) => p.base === key && p.mega && p.released);

export function renderMine(app, ctx) {
  const { data, esc, sprite, typeBadges, moveBadge } = ctx;
  let editingId = null;
  let query = '';
  // Pokémon read from screenshots, waiting to be checked and added. `prefill` is a draft loaded
  // into the form for fixing.
  let drafts = [];
  let prefill = null;
  let scanStatus = '';
  // Whether the player changed the moves in the form (so they're no longer "not checked").
  let movesTouched = false;

  // A species' best TM-able moves, used when its real moves aren't known yet.
  function bestMoves(key) {
    const [best] = bestMovesetsOverall(data.pokemon[key], data, { elite: false });
    return best ? { fast: best.fast, charged: [best.charged] } : {};
  }

  // Adds Pokémon to the list. A scan of a Pokémon's own page replaces a storage import of the
  // same Pokémon (same species and CP) whose moves weren't checked; a storage import of a
  // Pokémon already in the list is skipped.
  function addEntries(list, entries) {
    const next = [...list];
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const e of entries) {
      const same = next.findIndex((x) => x.key === e.key && x.cp === e.cp);
      if (same === -1) {
        next.push(e);
        added++;
      } else if (next[same].movesUnknown && !e.movesUnknown) {
        next[same] = { ...e, id: next[same].id, mega: next[same].mega || e.mega };
        updated++;
      } else {
        skipped++;
      }
    }
    return { next, added, updated, skipped };
  }

  const summary = ({ added, updated, skipped }) => [
    added && `Added ${added} Pokémon.`,
    updated && `Updated the moves of ${updated} you'd imported from storage.`,
    skipped && `${skipped} ${skipped === 1 ? 'was' : 'were'} already in your list.`,
  ].filter(Boolean).join(' ');

  const species = Object.entries(data.pokemon)
    .filter(([, p]) => p.released && !p.mega && !p.gmax && p.fast.length && p.charged.length)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const byName = new Map(species.map(([key, p]) => [p.name.toLowerCase(), key]));

  function moveOptions(ids, elite, selected) {
    return ids.map((id) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(data.moves[id].name)}${elite.includes(id) ? ' *' : ''}</option>`).join('');
  }

  function formFields(key, entry = {}) {
    const p = data.pokemon[key];
    const fast = [...p.fast, ...p.eliteFast];
    const charged = [...p.charged, ...p.eliteCharged];
    const ivs = entry.ivs || null;
    const check = (name, label, show, on) => (show ? `<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label>` : '');
    return `
      <label>Fast move<select name="fast">${moveOptions(fast, p.eliteFast, entry.fast)}</select></label>
      <label>Charged move<select name="charged1">${moveOptions(charged, p.eliteCharged, entry.charged?.[0])}</select></label>
      <label>Second charged move
        <select name="charged2"><option value="">None</option>${moveOptions(charged, p.eliteCharged, entry.charged?.[1])}</select>
      </label>
      <fieldset class="checks">
        ${check('shadow', 'Shadow', p.shadow, entry.shadow)}
        ${check('mega', 'I can Mega Evolve it', megaForms(data, key).length, entry.mega)}
        ${check('dynamax', 'Dynamax', p.dynamax, entry.dynamax)}
        ${check('gmax', 'Gigantamax', data.pokemon[`${key}_GIGANTAMAX`]?.dynamax, entry.gmax)}
      </fieldset>
      <details class="ivs" ${ivs ? 'open' : ''}>
        <summary>I know its IVs (from the in-game appraisal)</summary>
        <div class="iv-row">
          ${['atk', 'def', 'sta'].map((s, i) => `<label>${['Attack', 'Defence', 'HP'][i]}
            <input type="number" name="iv_${s}" min="0" max="15" inputmode="numeric" value="${ivs ? ivs[s] : ''}" placeholder="0–15"></label>`).join('')}
        </div>
      </details>
      <p class="hint" id="level-preview"></p>`;
  }

  function readIvs(f) {
    const vals = ['atk', 'def', 'sta'].map((s) => f[`iv_${s}`]?.value);
    if (vals.some((v) => v === '' || v === undefined)) return null;
    const [atk, def, sta] = vals.map((v) => Math.min(15, Math.max(0, Math.round(Number(v)))));
    return { atk, def, sta };
  }

  function updatePreview(form) {
    const f = form.elements;
    const key = byName.get(f.species.value.trim().toLowerCase());
    const out = form.querySelector('#level-preview');
    const cp = Number(f.cp.value);
    if (!out || !key || !cp) return out && (out.textContent = '');
    const ivs = readIvs(f);
    const level = estimateLevel(data, data.pokemon[key], cp, ivs || AVERAGE_IVS);
    out.textContent = `About level ${level}${ivs ? '' : ' (assuming average IVs; add its IVs for an exact level)'}.`;
  }

  function entryCard(e) {
    const p = data.pokemon[e.key];
    const tags = [e.shadow && 'Shadow', e.mega && 'Can Mega Evolve', e.gmax ? 'Gigantamax' : e.dynamax && 'Dynamax', e.ivs && `IVs ${e.ivs.atk}/${e.ivs.def}/${e.ivs.sta}`,
      e.movesUnknown && 'Moves not checked: best moves assumed']
      .filter(Boolean);
    return `
      <li class="mine-card">
        <img src="${sprite(p.dex)}" alt="" loading="lazy" width="56" height="56" onerror="this.style.visibility='hidden'">
        <div class="mine-body">
          <strong><a href="#/pokemon/${e.key}">${e.shadow ? 'Shadow ' : ''}${esc(p.name)}</a></strong> <span class="muted">CP ${e.cp} · Lv ${e.level}</span>
          <div>${typeBadges(p.types)}</div>
          <div class="moves">${moveBadge(e.fast, p.eliteFast.includes(e.fast))}${e.charged.filter(Boolean).map((c) => moveBadge(c, p.eliteCharged.includes(c))).join('')}</div>
          ${tags.length ? `<div>${tags.map((t) => `<span class="status">${t}</span>`).join(' ')}</div>` : ''}
        </div>
        <div class="mine-actions">
          <button type="button" data-edit="${e.id}">Edit</button>
          <button type="button" data-delete="${e.id}" class="danger">Delete</button>
        </div>
      </li>`;
  }

  const draftReady = (d) => d.key && d.cp && d.fast && d.charged.length;

  function draftToEntry(d) {
    return {
      id: crypto.randomUUID(),
      key: d.key, cp: d.cp, ivs: d.ivs || null,
      level: d.level ?? (d.key && d.cp ? estimateLevel(data, data.pokemon[d.key], d.cp, d.ivGuess || AVERAGE_IVS) : null),
      fast: d.fast, charged: d.charged,
      shadow: Boolean(d.shadow), mega: Boolean(d.mega), dynamax: Boolean(d.dynamax || d.gmax), gmax: Boolean(d.gmax),
      movesUnknown: Boolean(d.movesUnknown),
    };
  }

  function draftCard(d, i) {
    const p = d.key && data.pokemon[d.key];
    return `
      <li class="mine-card">
        ${p ? `<img src="${sprite(p.dex)}" alt="" width="56" height="56" onerror="this.style.visibility='hidden'">` : '<span class="rot-icon">?</span>'}
        <div class="mine-body">
          <strong>${p ? `${d.shadow ? 'Shadow ' : ''}${esc(p.name)}` : 'Unknown Pokémon'}</strong>
          ${d.source === 'storage' && d.name && (!p || d.name !== p.name) ? `<span class="muted">Named "${esc(d.name)}"</span>` : ''}
          <span class="muted">${d.cp ? `CP ${d.cp}` : 'CP ?'}${d.level ? ` · Lv ${d.level}` : ''}${d.ivs ? ` · IVs ${d.ivs.atk}/${d.ivs.def}/${d.ivs.sta}` : ''}</span>
          ${p ? `<div class="moves">${d.fast ? moveBadge(d.fast) : ''}${d.charged.map((c) => moveBadge(c)).join('')}</div>` : ''}
          ${d.dynamax || d.gmax ? `<div><span class="status">${d.gmax ? 'Gigantamax' : 'Dynamax'}</span></div>` : ''}
          ${d.megaActive ? `<div><span class="status">Mega Evolved now (${esc(data.pokemon[d.megaActive].name)})</span></div>` : ''}
          ${d.movesUnknown && p ? '<div><span class="status">From storage: best moves assumed</span></div>' : ''}
          ${d.problems.length ? `<div class="error">${d.problems.map(esc).join(' ')}</div>` : ''}
        </div>
        <div class="mine-actions">
          ${draftReady(d) ? `<button type="button" data-draft-add="${i}">Add</button>` : ''}
          <button type="button" data-draft-fix="${i}">${draftReady(d) ? 'Edit' : 'Fix'}</button>
          <button type="button" data-draft-skip="${i}" class="danger">Skip</button>
        </div>
      </li>`;
  }

  async function scan(files) {
    const pages = [];
    const fromStorage = [];
    for (let i = 0; i < files.length; i++) {
      scanStatus = `Reading screenshot ${i + 1} of ${files.length}…${i === 0 ? ' (the first one takes a little longer)' : ''}`;
      render();
      try {
        const shot = await readScreenshot(files[i]);
        if (shot.kind === 'storage') fromStorage.push(...readGridTiles(shot.tiles, data, shot.width));
        else pages.push(shot.parsed);
      } catch (err) {
        scanStatus = err.message || "Couldn't read that screenshot.";
        return render();
      }
    }
    // Storage screenshots taken while scrolling overlap, so the same tile can appear twice.
    const seen = new Set(drafts.map((d) => `${d.name}|${d.cp}`));
    const storageDrafts = fromStorage.filter((d) => {
      const id = `${d.name}|${d.cp}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const found = [...mergeScreens(pages).map((s) => readPokemon(s, data)), ...storageDrafts];
    drafts = [...drafts, ...found];
    scanStatus = `Found ${found.filter((d) => d.key).length} Pokémon${found.some((d) => !d.key) ? ` and ${found.filter((d) => !d.key).length} with nicknames to check` : ''}. Check them below, then add them.`;
    render();
  }

  function render() {
    const list = ctx.getCollection();
    const editing = list.find((e) => e.id === editingId) || prefill;
    const q = query.trim().toLowerCase();
    const shown = list
      .filter((e) => !q || data.pokemon[e.key].name.toLowerCase().includes(q))
      .sort((a, b) => data.pokemon[a.key].name.localeCompare(data.pokemon[b.key].name) || b.cp - a.cp);
    document.title = 'My Pokémon · Raid Boss Guide';
    app.innerHTML = `
      <section class="rotation-head">
        <h1>My Pokémon <small class="muted">(${list.length})</small></h1>
        <p class="hint">Add the Pokémon you'd take into raids and Max Battles. Every boss page then shows
        <strong>your best team</strong> next to the best possible one. Your list is saved on this device only.</p>
      </section>

      <section class="panel">
        <h2>Add from screenshots</h2>
        <p class="hint">Two kinds of screenshot work, and you can pick several at once:</p>
        <ul class="reasons">
          <li><strong>Your storage list</strong> (fastest): sort by CP and screenshot a few screens. Adds lots of Pokémon at once,
          with their best moves assumed, because storage doesn't show moves.</li>
          <li><strong>A Pokémon's own page</strong>: reads its real moves, and its exact level and IVs. If the moves are
          further down, take a second screenshot of them straight after. Scanning a Pokémon you imported from storage
          updates its moves.</li>
        </ul>
        <p class="hint">Screenshots are read on your phone and never uploaded.</p>
        <div class="form-actions">
          <label class="button primary">Choose screenshots<input type="file" id="scan" accept="image/*" multiple hidden></label>
          ${drafts.some(draftReady) ? `<button type="button" id="add-all">Add all ready (${drafts.filter(draftReady).length})</button>` : ''}
        </div>
        <p class="hint" role="status">${esc(scanStatus)}</p>
        ${drafts.length ? `<ul class="mine-list">${drafts.map(draftCard).join('')}</ul>` : ''}
      </section>

      <section class="panel">
        <h2>${editingId ? `Edit ${esc(data.pokemon[editing.key].name)}` : prefill ? `Check ${esc(data.pokemon[prefill.key]?.name || 'this Pokémon')}` : 'Add a Pokémon by hand'}</h2>
        <form id="add" class="settings mine-form" autocomplete="off">
          <label>Pokémon
            <input name="species" list="species-list" placeholder="Start typing, e.g. Tyranitar" required
              value="${editing?.key ? esc(data.pokemon[editing.key].name) : ''}">
            <datalist id="species-list">${species.map(([, p]) => `<option value="${esc(p.name)}">`).join('')}</datalist>
          </label>
          <label>CP<input name="cp" type="number" min="10" max="9999" inputmode="numeric" required value="${editing?.cp || ''}" placeholder="e.g. 3200"></label>
          <div id="fields" class="settings">${editing?.key ? formFields(editing.key, editing) : ''}</div>
          <div class="form-actions">
            <button type="submit" class="primary">${editingId ? 'Save changes' : 'Add Pokémon'}</button>
            ${editing ? '<button type="button" id="cancel">Cancel</button>' : ''}
          </div>
          <p class="error" id="form-error" role="alert"></p>
        </form>
      </section>

      <section class="panel">
        <div class="party-head">
          <h2>Your Pokémon</h2>
          ${list.length > 8 ? `<input id="mine-search" type="search" placeholder="Search" value="${esc(query)}">` : ''}
        </div>
        ${list.length ? `<ul class="mine-list">${shown.map(entryCard).join('')}</ul>`
    : '<p class="hint">Nothing here yet. Add your strongest raid Pokémon above, e.g. your best Fire, Water, Dragon and Dark types.</p>'}
      </section>

      <section class="panel">
        <h2>Backup</h2>
        <p class="hint">Your list lives in this browser. Download a backup to keep it safe or move it to another phone.</p>
        <div class="form-actions">
          <button type="button" id="export" ${list.length ? '' : 'disabled'}>Download backup</button>
          <label class="button">Load backup<input type="file" id="import" accept="application/json,.json" hidden></label>
        </div>
        <p class="hint" id="backup-msg" role="status"></p>
      </section>`;

    const form = app.querySelector('#add');
    const f = form.elements;
    if (editing?.key) updatePreview(form);

    app.querySelector('#scan').addEventListener('change', (e) => {
      const files = [...e.target.files];
      if (files.length) scan(files);
    });
    app.querySelector('#add-all')?.addEventListener('click', () => {
      const ready = drafts.filter(draftReady);
      const result = addEntries(list, ready.map(draftToEntry));
      if (ctx.setCollection(result.next)) {
        drafts = drafts.filter((d) => !draftReady(d));
        scanStatus = summary(result);
        render();
      }
    });
    app.querySelectorAll('[data-draft-add], [data-draft-fix], [data-draft-skip]').forEach((b) => b.addEventListener('click', () => {
      const { draftAdd, draftFix, draftSkip } = b.dataset;
      const i = Number(draftAdd ?? draftFix ?? draftSkip);
      const d = drafts[i];
      drafts = drafts.filter((_, j) => j !== i);
      if (draftAdd !== undefined) {
        const result = addEntries(list, [draftToEntry(d)]);
        ctx.setCollection(result.next);
        scanStatus = summary(result);
      }
      if (draftFix !== undefined) {
        prefill = draftToEntry(d);
        editingId = null;
      }
      render();
      if (draftFix !== undefined) app.querySelector('#add').scrollIntoView({ behavior: 'smooth' });
    }));

    movesTouched = false;
    f.species.addEventListener('input', () => {
      const key = byName.get(f.species.value.trim().toLowerCase());
      // A nicknamed storage import gets its species' best moves until they're checked.
      app.querySelector('#fields').innerHTML = key ? formFields(key, editing?.movesUnknown ? bestMoves(key) : {}) : '';
      updatePreview(form);
    });
    form.addEventListener('input', (e) => {
      if (e.target.name !== 'species') updatePreview(form);
      if (['fast', 'charged1', 'charged2'].includes(e.target.name)) movesTouched = true;
    });
    form.addEventListener('change', (e) => {
      // Gigantamax Pokémon can always Dynamax.
      if (e.target.name === 'gmax' && e.target.checked && f.dynamax) f.dynamax.checked = true;
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const error = form.querySelector('#form-error');
      const key = byName.get(f.species.value.trim().toLowerCase());
      const cp = Math.round(Number(f.cp.value));
      if (!key) return (error.textContent = 'Pick a Pokémon from the list.');
      if (!cp || cp < 10) return (error.textContent = 'Enter its CP.');
      const ivs = readIvs(f);
      // Keep a level that came from a screenshot (exact, or a Mega's CP) unless CP or IVs changed.
      const keepLevel = editing?.level && editing.key === key && editing.cp === cp && !ivs === !editing.ivs;
      const entry = {
        id: editingId || crypto.randomUUID(),
        key, cp, ivs,
        level: keepLevel ? editing.level : estimateLevel(data, data.pokemon[key], cp, ivs || AVERAGE_IVS),
        movesUnknown: Boolean(editing?.movesUnknown) && !movesTouched,
        fast: f.fast.value,
        charged: [f.charged1.value, f.charged2.value].filter(Boolean),
        shadow: Boolean(f.shadow?.checked),
        mega: Boolean(f.mega?.checked),
        dynamax: Boolean(f.dynamax?.checked || f.gmax?.checked),
        gmax: Boolean(f.gmax?.checked),
      };
      const next = editingId ? list.map((x) => (x.id === editingId ? entry : x)) : addEntries(list, [entry]).next;
      if (!ctx.setCollection(next)) return (error.textContent = "Couldn't save. Is private browsing on?");
      editingId = null;
      prefill = null;
      render();
    });
    app.querySelector('#cancel')?.addEventListener('click', () => {
      editingId = null;
      prefill = null;
      render();
    });

    app.querySelector('#mine-search')?.addEventListener('input', (e) => {
      query = e.target.value;
      app.querySelector('.mine-list').innerHTML = list
        .filter((x) => data.pokemon[x.key].name.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => data.pokemon[a.key].name.localeCompare(data.pokemon[b.key].name) || b.cp - a.cp)
        .map(entryCard).join('');
    });
    app.querySelector('.mine-list')?.addEventListener('click', (e) => {
      const { edit, delete: del } = e.target.dataset;
      if (edit) {
        editingId = edit;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (del) {
        const victim = list.find((x) => x.id === del);
        if (victim && confirm(`Delete ${data.pokemon[victim.key].name} (CP ${victim.cp})?`)) {
          ctx.setCollection(list.filter((x) => x.id !== del));
          render();
        }
      }
    });

    app.querySelector('#export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ app: 'raid-boss-guide', version: 1, pokemon: list }, null, 1)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `my-pokemon-${new Date().toISOString().slice(0, 10)}.json`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    });
    app.querySelector('#import').addEventListener('change', async (e) => {
      const msg = app.querySelector('#backup-msg');
      const file = e.target.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const incoming = validEntries(data, Array.isArray(parsed) ? parsed : parsed.pokemon || []);
        const ids = new Set(list.map((x) => x.id));
        const added = incoming.filter((x) => !ids.has(x.id));
        ctx.setCollection([...list, ...added]);
        render();
        app.querySelector('#backup-msg').textContent = `Added ${added.length} Pokémon from the backup${incoming.length > added.length ? ` (${incoming.length - added.length} already here)` : ''}.`;
      } catch {
        msg.textContent = "That file isn't a Raid Boss Guide backup.";
      }
    });
  }

  render();
}
