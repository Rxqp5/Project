# Raid Boss Guide

A Pokémon GO raid companion app. It covers every raid boss (1★ to 5★, Elite, Shadow, Mega, Mega Legendary, Primal and Super Mega), shows which are in raids right now or coming soon, and gives, for each one:

- **Weaknesses and resistances**, including double weaknesses (2.56×)
- **Boss CP, catch CP** (normal and weather boosted) and boosting weather
- **Top counters**, ranked by simulated damage (DPS, TDO and a 0–100 rating)
- **Suggested raid parties**: a best team and a budget team (no Megas, Shadows or Legendaries), plus a rough count of trainers needed
- **Best moves** for the boss once you catch it, and the moves the boss can use against you
- **Super Mega raids**: shield count, how the shields work, and the best Megas to bring (every trainer needs one)

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
- [Pokebattler](https://www.pokebattler.com): current, upcoming and past raid bosses for every tier, plus stats and moves for Megas and moves newer than the game master
- [pogoapi.net](https://pogoapi.net): older raid history (last updated November 2025)

**Super Mega raids** (since February 2026) come in a 4★ and a 5★ tier with 25,000 HP. The boss starts with shields (usually 7 to 10). While they're up it deals 2× damage and takes 4× less. Only a Mega-Evolved Pokémon can break a shield, one per trainer, so you need at least as many trainers with Megas as there are shields.

**Counter rankings** use the community-standard method (the GamePress formula): for every attacker, each fast and charged move pair is simulated against the boss, taking into account type effectiveness, same-type attack bonus (STAB), weather boost, energy gained and the damage the boss deals back. Attackers are ranked by DPS³ × TDO. These are estimates, like any raid calculator's.

## Adding a raid boss by hand

If a boss is missing, add it to `data/raids-extra.json` (past Super Mega bosses are listed there already):

```json
{ "bosses": [{ "key": "VICTREEBEL_MEGA", "tier": "super_mega_4", "shields": 8 }] }
```

`key` is the Pokémon's id in `data/game.json`. `tier` is one of `1`, `3`, `5`, `elite`, `mega`, `mega_legendary`, `primal`, `super_mega_4`, `super_mega_5`, `shadow_1`, `shadow_3` or `shadow_5`. Optional: `status` (`past`, `current` or `upcoming`) and `shields`. Then run `npm run build:data`.

---
Fan-made tool. Not affiliated with Niantic, Nintendo or The Pokémon Company.
