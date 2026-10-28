# Raid Boss Guide

A Pokémon GO raid companion app. It covers every raid boss (1★ to 5★, Mega, Mega Legendary and Primal) and shows, for each one:

- **Weaknesses and resistances**, including double weaknesses (2.56×)
- **Boss CP, catch CP** (normal and weather boosted) and boosting weather
- **Top counters**, ranked by simulated damage (DPS, TDO and a 0–100 rating)
- **Suggested raid parties**: a best team and a budget team (no Megas, Shadows or Legendaries), plus a rough count of trainers needed
- **Best moves** for the boss once you catch it, and the moves the boss can use against you

Counters change with your settings: Pokémon level (40/50), weather, the boss's moveset, and whether to include Megas, Shadows, Legendaries and Elite TM moves.

It runs in any browser, works on phones, and can be added to the home screen like an app (it also works offline).

## Running it

Needs [Node.js](https://nodejs.org) 18 or newer. There are no packages to install.

```sh
npm start          # open http://localhost:8080
npm test           # run the calculation tests
npm run build:data # re-download game data and rebuild data/game.json
```

## How it works

| Path | What it is |
| --- | --- |
| `index.html`, `src/app.js`, `src/styles.css` | The app's screens |
| `src/calc.js` | Battle maths: type chart, damage formula, counter ranking, parties |
| `scripts/build-data.mjs` | Builds `data/game.json` from public data sources |
| `data/game.json` | Generated data: every Pokémon, move and raid boss |
| `data/raids-extra.json` | Raid bosses added by hand (see below) |

**Data sources**
- [PokeMiners game master](https://github.com/PokeMiners/game_masters): official stats, moves, Megas/Primals, weather and the type chart
- [PvPoke](https://github.com/pvpoke/pvpoke): which Pokémon and Shadows are released, and display names
- [pogoapi.net](https://pogoapi.net): history of 1★ to 5★ raid bosses (last updated November 2025)

Mega, Mega Legendary and Primal bosses are generated from every released Mega in the game master.

**Counter rankings** use the community-standard method (the GamePress formula): for every attacker, each fast and charged move pair is simulated against the boss, taking into account type effectiveness, same-type attack bonus (STAB), weather boost, energy gained and the damage the boss deals back. Attackers are ranked by DPS³ × TDO. These are estimates, like any raid calculator's.

## Adding a raid boss by hand

If a boss is missing (anything after November 2025, for example), add it to `data/raids-extra.json`:

```json
{ "bosses": [{ "key": "ZACIAN_CROWNED_SWORD", "tier": "5" }] }
```

`key` is the Pokémon's id in `data/game.json`. `tier` is one of `1`, `3`, `5`, `mega`, `mega_legendary` or `primal`. Then run `npm run build:data`.

---
Fan-made tool. Not affiliated with Niantic, Nintendo or The Pokémon Company.
