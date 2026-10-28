# Raid Boss Guide

A Pokémon GO raid companion app. It covers every raid boss (1★ to 5★, Elite, Shadow, Mega, Mega Legendary, Primal and Super Mega) and every Max Battle boss (Dynamax 1★ to 5★ and Gigantamax).

The home screen is the **raid rotation**, day by day from today. On the first day a boss appears it shows the full start and end date and time. Raid Hours, Raid Days and Max Mondays are listed on their days, and today also shows the undated 1★/3★ lineup. The rotation is loaded live from LeekDuck each time you open the app, with a saved copy for offline use.

For each boss the app gives:

- **Weaknesses and resistances**, including double weaknesses (2.56×)
- **Boss CP, catch CP** (normal and weather boosted) and boosting weather
- **Top counters**, ranked by simulated damage (DPS, TDO and a 0–100 rating)
- **Suggested raid parties**: a best team and a budget team (no Megas, Shadows or Legendaries), plus a rough count of trainers needed
- **Best moves** for the boss once you catch it, and the moves the boss can use against you
- **Super Mega raids**: shield count, how the shields work, and the best Megas to bring (every trainer needs one)
- **Max Battles**: the best Dynamax/Gigantamax attackers (ranked by Max Attack damage), the best tanks, and a suggested team of three

**My Pokémon:** add the Pokémon you own (species, CP, moves, and optionally Shadow, can Mega Evolve, Dynamax/Gigantamax and IVs). The app works out each one's level from its CP. Every boss page then shows **your best team** next to the best possible team, plus TM tips ("TM your Tyranitar to Brutal Swing for about 19% more damage"). Your list is saved on your device only, and you can download it as a backup file and load it again on another device. Pokémon GO has no official way for apps to read your account, so the list is entered by hand.

Counters change with your settings: Pokémon level (40/50), weather, the boss's moveset, and whether to include Megas, Shadows, Legendaries and Elite TM moves.

It runs in any browser, works on phones, and can be added to the home screen like an app (it also works offline).

## Live app

**https://rxqp5.github.io/Project/**: open it on your phone and use "Add to Home Screen" to install it like an app.

It's published by GitHub Pages (`.github/workflows/pages.yml`) on every change to `main`, and rebuilt every day with fresh game data. You can also trigger a rebuild by hand from the repository's **Actions** tab ("Deploy to GitHub Pages", then "Run workflow").

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
| `src/calc.js` | Battle maths: type chart, damage formula, counter ranking, parties, Max Battles |
| `src/schedule.js` | Turns the LeekDuck event calendar into the day-by-day rotation |
| `src/collection.js` | Your own Pokémon: level from CP, ranking them against a boss, TM tips, saving |
| `src/mine.js` | The My Pokémon page |
| `scripts/build-data.mjs` | Builds `data/game.json` from public data sources |
| `data/game.json` | Generated data: every Pokémon, move and raid boss |
| `data/raids-extra.json` | Raid bosses added by hand (see below) |

**Data sources**
- [PokeMiners game master](https://github.com/PokeMiners/game_masters): official stats, moves, Megas/Primals, weather and the type chart
- [PvPoke](https://github.com/pvpoke/pvpoke): which Pokémon and Shadows are released, and display names
- [Pokebattler](https://www.pokebattler.com): current, upcoming and past raid bosses for every tier, plus stats and moves for Megas and moves newer than the game master
- [pogoapi.net](https://pogoapi.net): older raid history (last updated November 2025)
- [LeekDuck](https://leekduck.com/events/) via [ScrapedDuck](https://github.com/bigfoott/ScrapedDuck): raid rotation dates and the current lineup

**Super Mega raids** (since February 2026) come in a 4★ and a 5★ tier with 25,000 HP. The boss starts with shields (usually 7 to 10). While they're up it deals 2× damage and takes 4× less. Only a Mega-Evolved Pokémon can break a shield, one per trainer, so you need at least as many trainers with Megas as there are shields.

**Max Battles** only allow Dynamax Pokémon, three per trainer. Attackers are ranked by the damage of one level-3 Max Attack (350 power, or 450 for a matching G-Max move), whose type is the fast move's type. Tanks are ranked by how long they survive the boss's attacks.

**Counter rankings** use the community-standard method (the GamePress formula): for every attacker, each fast and charged move pair is simulated against the boss, taking into account type effectiveness, same-type attack bonus (STAB), weather boost, energy gained and the damage the boss deals back. Attackers are ranked by DPS³ × TDO. These are estimates, like any raid calculator's.

## Adding a raid boss by hand

If a boss is missing, add it to `data/raids-extra.json` (past Super Mega bosses are listed there already):

```json
{ "bosses": [{ "key": "VICTREEBEL_MEGA", "tier": "super_mega_4", "shields": 8 }] }
```

`key` is the Pokémon's id in `data/game.json`. `tier` is one of `1`, `3`, `5`, `elite`, `mega`, `mega_legendary`, `primal`, `super_mega_4`, `super_mega_5`, `shadow_1`, `shadow_3`, `shadow_5`, `max_1` to `max_5` (Dynamax) or `max_6` (Gigantamax). Optional: `status` (`past`, `current` or `upcoming`) and `shields`. Then run `npm run build:data`.

---
Fan-made tool. Not affiliated with Niantic, Nintendo or The Pokémon Company.
