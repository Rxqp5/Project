// "My Pokémon" page: the player's own Pokémon, entered by hand and saved on this device.

import { AVERAGE_IVS, estimateLevel, validEntries } from './collection.js';

const megaForms = (data, key) => Object.values(data.pokemon).filter((p) => p.base === key && p.mega && p.released);

export function renderMine(app, ctx) {
  const { data, esc, sprite, typeBadges, moveBadge } = ctx;
  let editingId = null;
  let query = '';

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
    const tags = [e.shadow && 'Shadow', e.mega && 'Can Mega Evolve', e.gmax ? 'Gigantamax' : e.dynamax && 'Dynamax', e.ivs && `IVs ${e.ivs.atk}/${e.ivs.def}/${e.ivs.sta}`]
      .filter(Boolean);
    return `
      <li class="mine-card">
        <img src="${sprite(p.dex)}" alt="" loading="lazy" width="56" height="56" onerror="this.style.visibility='hidden'">
        <div class="mine-body">
          <strong>${e.shadow ? 'Shadow ' : ''}${esc(p.name)}</strong> <span class="muted">CP ${e.cp} · Lv ${e.level}</span>
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

  function render() {
    const list = ctx.getCollection();
    const editing = list.find((e) => e.id === editingId);
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
        <h2>${editing ? `Edit ${esc(data.pokemon[editing.key].name)}` : 'Add a Pokémon'}</h2>
        <form id="add" class="settings mine-form" autocomplete="off">
          <label>Pokémon
            <input name="species" list="species-list" placeholder="Start typing, e.g. Tyranitar" required
              value="${editing ? esc(data.pokemon[editing.key].name) : ''}">
            <datalist id="species-list">${species.map(([, p]) => `<option value="${esc(p.name)}">`).join('')}</datalist>
          </label>
          <label>CP<input name="cp" type="number" min="10" max="9999" inputmode="numeric" required value="${editing ? editing.cp : ''}" placeholder="e.g. 3200"></label>
          <div id="fields" class="settings">${editing ? formFields(editing.key, editing) : ''}</div>
          <div class="form-actions">
            <button type="submit" class="primary">${editing ? 'Save changes' : 'Add Pokémon'}</button>
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
    if (editing) updatePreview(form);

    f.species.addEventListener('input', () => {
      const key = byName.get(f.species.value.trim().toLowerCase());
      app.querySelector('#fields').innerHTML = key ? formFields(key) : '';
      updatePreview(form);
    });
    form.addEventListener('input', (e) => {
      if (e.target.name !== 'species') updatePreview(form);
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
      const entry = {
        id: editingId || crypto.randomUUID(),
        key, cp, ivs,
        level: estimateLevel(data, data.pokemon[key], cp, ivs || AVERAGE_IVS),
        fast: f.fast.value,
        charged: [f.charged1.value, f.charged2.value].filter(Boolean),
        shadow: Boolean(f.shadow?.checked),
        mega: Boolean(f.mega?.checked),
        dynamax: Boolean(f.dynamax?.checked || f.gmax?.checked),
        gmax: Boolean(f.gmax?.checked),
      };
      const next = editingId ? list.map((x) => (x.id === editingId ? entry : x)) : [...list, entry];
      if (!ctx.setCollection(next)) return (error.textContent = "Couldn't save. Is private browsing on?");
      editingId = null;
      render();
    });
    app.querySelector('#cancel')?.addEventListener('click', () => {
      editingId = null;
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
