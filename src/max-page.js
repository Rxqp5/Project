// Max Battles page: the Max Battles running now, your best Dynamax team for each, how useful each
// of your Dynamax Pokémon is, and the Dynamax Pokémon worth getting.

import { TIERS, rankMaxAttackers, rankMaxTanks, pickMaxTeam } from './calc.js';
import { rankOwnedMax } from './collection.js';

// 1★ Max Battles are easy enough for any team, so they're left out.
const MAX_TIERS = ['max_6', 'max_5', 'max_4', 'max_3', 'max_2'];

// The pure part, so it can be tested: per boss, your team and the best possible attackers.
export function maxOverview(data, collection) {
  const bosses = data.raids
    .filter((r) => r.status === 'current' && MAX_TIERS.includes(r.tier))
    .sort((a, b) => MAX_TIERS.indexOf(a.tier) - MAX_TIERS.indexOf(b.tier) || data.pokemon[a.key].dex - data.pokemon[b.key].dex)
    .map((b) => {
      const owned = rankOwnedMax(data, b.key, b.tier, collection);
      return {
        ...b,
        yours: pickMaxTeam(owned.attackers, owned.tanks, { idOf: (c) => c.entryId }),
        bestAttackers: rankMaxAttackers(data, b.key, b.tier).slice(0, 5),
        bestTanks: rankMaxTanks(data, b.key, b.tier).slice(0, 3),
      };
    });

  // How often each of your Dynamax Pokémon makes your team.
  const usage = new Map();
  for (const b of bosses) {
    for (const m of b.yours) {
      const u = usage.get(m.entryId) || { member: m, bosses: [] };
      u.bosses.push({ ...b, role: m.role });
      usage.set(m.entryId, u);
    }
  }
  const dynamaxOwned = collection.filter((e) => e.dynamax || e.gmax);

  // Species that are among the best for these bosses but that you don't have as Dynamax.
  const ownedKeys = new Set(dynamaxOwned.flatMap((e) => [e.key, `${e.key}_GIGANTAMAX`]));
  const wanted = new Map();
  for (const b of bosses) {
    for (const [list, role] of [[b.bestAttackers, 'Attacker'], [b.bestTanks, 'Tank']]) {
      for (const c of list) {
        if (ownedKeys.has(c.key)) continue;
        const w = wanted.get(c.key) || { key: c.key, dex: c.dex, name: c.name, types: c.types, bosses: [], roles: new Set() };
        if (!w.bosses.some((x) => x.key === b.key && x.tier === b.tier)) w.bosses.push(b);
        w.roles.add(role);
        wanted.set(c.key, w);
      }
    }
  }
  return {
    bosses,
    usage: [...usage.values()].sort((a, b) => b.bosses.length - a.bosses.length),
    unused: dynamaxOwned.filter((e) => !usage.has(e.id)),
    wanted: [...wanted.values()].sort((a, b) => b.bosses.length - a.bosses.length).slice(0, 10),
  };
}

export function renderMax(app, ctx) {
  const { data, esc, sprite, typeBadge, typeBadges, moveBadge, bossName } = ctx;
  document.title = 'Max Battles · Raid Boss Guide';
  const collection = ctx.getCollection();
  const { bosses, usage, unused, wanted } = maxOverview(data, collection);
  const hasDynamax = collection.some((e) => e.dynamax || e.gmax);
  const maxMove = (a) => `${typeBadge(a.maxType)}${a.gmaxMove ? ' <span class="status status-soon">G-Max</span>' : ''}`;
  const memberCard = (c) => `
    <li>
      <img src="${sprite(c.dex, c.shiny)}" alt="" loading="lazy" width="56" height="56" onerror="this.style.visibility='hidden'">
      <span class="status">${c.role}</span>
      <strong>${esc(c.name)}</strong>
      <span class="muted">CP ${c.cp}</span>
      ${c.role === 'Tank' ? `<span class="muted">Survives ~${Math.round(c.survival)}s</span>` : `<span>${moveBadge(c.fast)}</span><span>${maxMove(c)}</span>`}
    </li>`;

  app.innerHTML = `
    <section class="rotation-head">
      <h1>Max Battles</h1>
      <p class="hint">The Max Battles at Power Spots now (2★ and up), with your best Dynamax team for each: two hard
      hitters and a tank. Only Pokémon marked Dynamax or Gigantamax on <a href="#/mine">My Pokémon</a> count.</p>
    </section>

    ${hasDynamax ? '' : `<section class="panel note"><p>None of your Pokémon are marked Dynamax yet. Scan their pages
      (the app spots "Max Moves") or tick Dynamax on <a href="#/mine">My Pokémon</a>.</p></section>`}

    ${bosses.map((b) => {
    const p = data.pokemon[b.key];
    return `
      <section class="panel">
        <div class="party-head">
          <h2><a href="#/boss/${b.tier}/${b.key}">${esc(bossName(b))}</a></h2>
          <span class="tier tier-${b.tier}">${TIERS[b.tier].label}</span>
        </div>
        <div>${typeBadges(p.types)}</div>
        ${b.yours.length ? `<ol class="party-list">${b.yours.map(memberCard).join('')}</ol>`
    : `<p class="hint">You have no Dynamax Pokémon for this one. Best: ${b.bestAttackers.slice(0, 3).map((a) => esc(a.name)).join(', ')}.</p>`}
      </section>`;
  }).join('') || '<p class="empty">No Max Battles are listed right now.</p>'}

    ${usage.length ? `
    <section class="panel">
      <h2>Your Dynamax Pokémon</h2>
      <ul class="mine-list">${usage.map(({ member: m, bosses: list }) => `
        <li class="mine-card">
          <img src="${sprite(m.dex, m.shiny)}" alt="" loading="lazy" width="48" height="48" onerror="this.style.visibility='hidden'">
          <div class="mine-body">
            <strong>${esc(m.name)}</strong> <span class="muted">CP ${m.cp}</span>
            <span class="hint">In your team for ${list.length} Max Battle${list.length > 1 ? 's' : ''}
              (${[...new Set(list.map((x) => x.role.toLowerCase()))].join(' and ')}):
              ${list.slice(0, 4).map((x) => esc(bossName(x))).join(', ')}${list.length > 4 ? '…' : ''}</span>
          </div>
        </li>`).join('')}</ul>
      ${unused.length ? `<p class="hint">Not needed for the current Max Battles: ${unused.map((e) => esc(data.pokemon[e.key].name)).join(', ')}.</p>` : ''}
    </section>` : ''}

    <section class="panel">
      <h2>Worth getting as Dynamax</h2>
      <p class="hint">Among the best attackers or tanks for the current Max Battles, and you don't have them as Dynamax yet.</p>
      ${wanted.length ? `<ul class="mine-list">${wanted.map((w) => `
        <li class="mine-card">
          <img src="${sprite(w.dex)}" alt="" loading="lazy" width="48" height="48" onerror="this.style.visibility='hidden'">
          <div class="mine-body">
            <strong><a href="#/pokemon/${data.pokemon[w.key].base || w.key}">${esc(w.name)}</a></strong>
            <div>${typeBadges(w.types)} ${[...w.roles].map((r) => `<span class="status">${r}</span>`).join(' ')}</div>
            <span class="hint">Top pick for ${w.bosses.length}: ${w.bosses.slice(0, 4).map((x) => esc(bossName(x))).join(', ')}${w.bosses.length > 4 ? '…' : ''}</span>
          </div>
        </li>`).join('')}</ul>` : '<p class="hint">You already have the best ones.</p>'}
    </section>`;
}
