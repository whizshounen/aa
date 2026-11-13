# Beast Bot v5 — RO Survivors (build f254752): final report, LOOT-FIRST

**Date:** 2026-11-10/11 · **Site:** https://ro-survivors.com/ · **Build:** f254752 (live bundle
SHA-256 `3cd2b65c…` — unchanged; auto-check verified on every launch)
**Bot:** `bot/bot5.js` (v5.0 loot-first + v5.1 bait-cast fix, in-file) + `bot/README.md`
(v5 section) + `rea/patch.py` (snapshot extended: `runLoot`, `mobLoot`,
`runCards`, `runEggs`, `nextEliteAt`, `nextHordeAt`, `mvpUntil`; patched bundle
sha256 `55cd07b9…`) + `loot-spec.md` (the loot inventory this bot is built on)
**Scope:** guest only, normal Prontera only, read-only patch, never Endless Tower /
ladder / saves / the user's account. All testing on throwaway guest characters.
**Headed:** the official 3-run set ran **headed under Xvfb** (not headless) with
Playwright video recording + periodic screenshots, per Araso's live-viewing
requirement. No processes left running at the end (verified: 0 bot/relay/Xvfb).

## Verdict in one line

**Acceptance NOT reached — but the loot goal moved the failure, and the loot is
now measured for the first time.** 0/3 clears, Eclipse never killed (best 62%
of its HP in run 3), Mastering never seen. Loot/min is now a real measured
number (mean **207.2** across the 3 headed runs) — but v4 never recorded any
loot number at all, so "clearly above v4's loot/min" cannot be claimed, and on
the only comparable proxy (kills/min) v5 is *worse* than v4 (58.6 vs 79.8).
The new binding constraint is **HP economy through the Eclipse fight**:
the v5.1 bait-cast finally deals boss damage (up to 2,104 HP), but each burn
costs ~120 HP against a pack at density cap that the bot cannot thin while
burning, so it either dies in the burn or survives it too hurt to finish the
boss.

## 1. What changed vs v4

| Area | v4 | v5 |
|---|---|---|
| Objective | Kills/XP/survival; loot incidental; "stop fighting mini-bosses" | **Loot/min primary**, survival only as the means to keep farming; mini-bosses are loot and must be killed |
| Loot inventory | None (no loot counters anywhere) | `loot-spec.md`: every loot source extracted from the bundles — gem tiers/merging, zeny 22%, chest 0.25% / elite-guaranteed, magnet 0.05%/10%, meat rules, gear `Dd` table + per-run cap, cards 0.01%/0.001%, eggs 0.1%/0.01%, boss drops (12 gems + meat ×2 + zeny + ≤1 gear), chest cost curve, full chest-item catalogue, Discovery formula |
| Planner | DPS-per-level; Discovery gated to Lv 6+/240s+ | **Loot-first scoring:** Discovery sources (Elixir of Surprise, Blessing of Plenty, Deity of Avarice/Wisdom) +320 early / +180 late; zeny sources +200 early (zeny buys chests); pickup radius +220; deity cards +80; AoE value raised (targets divisor live/3, not /4 — more kills = more gems); Bash/Magnum/Sword Dance DPS core kept; never reroll a loot card away; debuff-description "damage" no longer inflates debuff cards above Bash (smoke-run fix) |
| Routing | Gems only when field thin (nearest>350); chest 1.2 | **Value-weighted routing:** gear/card/egg 2.0, magnet 1.4, chest 1.6 if affordable else 0.3 (chestCost = 30+25n+1.5n²), meat 1.4, gems by value (red>yellow>blue) and collected when nearest>120px; elites pulled toward when safe (5× gems + guaranteed chest) |
| Boss play | Ring-hold 710–760, burn at minReady>2.0s; v4's advice: skip minis | **v5.0:** ring-hold + farm adds + burn at minReady>1.0s, kill minis for drops. **v5.1 (live fix, see §6):** bait-cast — if no burn window fires for >8 game-s, dive in to force a cast; farm adds in the ring when the boss can't reach |
| Metrics | kills/min, XP/min (broken proxy), picks, HP | **Loot ledger (new):** gemExp/min, zeny/min (earned = end + chest spend), chests/min, gear/cards/eggs, boss drops per boss, pickups left on field, composite loot/min = (gemExp + zenyEarned + 100·chests + 200·(gear+cards+eggs)) / game-min |
| Runs | Headless | **Headed under Xvfb + video + periodic screenshots** (see §7) |

## 2. Loot spec (summary — full inventory in `loot-spec.md`)

- **Gems are the loot engine:** every kill drops its `def.exp` in gems (elites 5×);
  blue ≤2, yellow ≤10, red >10; gems merge past 350 on-field pickups.
- **Zeny:** 22% of normal kills, `(1+ceil(exp/2)) × 2 × zenyMult`; bosses pay
  `round(exp×0.6)`.
- **Chests:** 0.25% of normal kills, guaranteed from elites; cost
  `30+25n+1.5n²` zeny (30/57/86/…/430 for chests 1/2/3/…/10); the only source
  of potions/elixirs/blessings/deities — zeny is chest fuel.
- **Elites:** one per 45 s; 5× gems + guaranteed chest + meat + zeny
  `(15+exp×3)` + 10% magnet. **Hordes:** every 120 s, `min(120, 36+t/8)` enemies.
- **Bosses:** 12 gem drops + meat ×2 + zeny + at most 1 gear piece + card
  (0.1%) / egg (0.1%) rolls. Four minis ≈ 4 gear rolls + ~48 gem drops.
- **Discovery:** only re-weights quality rolls (Legendary 1.5% → 5.0% at +100%,
  7.5% at +300% cap). Sources: Elixir of Surprise +10–20%, Blessing of Plenty
  +4–10% zeny **and** discovery, Deity of Avarice +10–20% zeny+discovery,
  Deity of Wisdom +10–20% exp+discovery.
- **Unpinned (stated, not guessed):** the `qc`/`QM`/`Zv` numeric values and the
  MVP/mini quality-tier constants (minified `soul_linker` aliases), per-monster
  `def.exp`, and the `Hf` mvpUntil offset.

## 3. v4 loot baseline (reconstructed — v4 recorded no loot)

| Metric | v4 main runs (Swordsman, 3 runs) |
|---|---|
| kills/min | 93.2 / 80.5 / 65.9 (mean **79.8**; best single run 96.2) |
| Level at death | 10 / 9 / 10 at 172.6 / 182.0 / 202.2 s game |
| Boss kills | 0 (Eclipse never killed; Mastering never seen) |
| Chests opened / zeny / gems / cards / gear | **unrecorded (0 known)** |
| Pickups left on screen at death | 7 / 38 / 19 |

v4's `xpPerGameMin` (65.7 / 105.8 / −10.5) is broken (goes negative when
`expNext` changes) and is **not** used as a baseline. The honest baseline is:
**v4 loot/min = unmeasured; kills/min 79.8 mean is the only comparable proxy.**

## 4. Main runs (Swordsman, v5.1, HEADED + video, 3 runs)

| Run | Wall | Game | Ratio | Level | Kills (/min) | HP min | Loot/min | gemExp/min | zeny/min | Chests | Gear/Cards/Eggs | Boss dmg | Death |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 487 s | 153.3 s | 0.315 | 9 | 190 (74.4) | 0 (died t=154) | **232.2** | 102.2 | 90.8 | 1 | 0/0/0 | 0 | Eclipse spawn burst: 2 stuck escapes pre-spawn, entered at 110/138 HP, dead 4 game-s after spawn |
| 2 | 516 s | 167.1 s | 0.324 | 8 | 155 (55.7) | 0 (died t=169) | **201.8** | 66.8 | 63.2 | 2 | 0/0/0 | **1,706** (3400→1694) | Burned Eclipse to 50%, died at 8px from it, HP 16/137, nearest enemy 8px, 70 live |
| 3 | 848 s | 270.0 s | 0.318 | 9 | 206 (45.8) | 0 (died t=271) | **187.6** | 60.4 | 60.4 | 3 | 0/0/0 | **2,104** (3400→1296) | Longest run of the bot line; burned Eclipse to 62%, survived at 7 HP, then horde (166 live) finished it at t≈270 |

Means (3 headed runs): **loot/min 207.2, gemExp/min 76.5, zeny/min 71.5,
chests 2.0/run (0.59/min), kills/min 58.6, game time 196.8 s, level 8.7.**
No run cleared, no boss killed, Mastering never seen, 0 gear/cards/eggs in
551 total kills (mobLoot stayed 0 — no gear drop rolled in any run; the only
card this whole task was 1 card in the killed headed2 run, §6).

Per-run detail (from `logs-v5/summary-2026-11-10T19-25-31.json`):
- Run 1: maxLive 70, timeAbove55 22 s, stuck escapes 2, modes engage 2380 /
  emergency 468 / thin 151 / boss 64 ticks; dmgBy sword 5.0k / magnum 7.3k /
  sword_dance 2.3k (no Bash damage — Bash never offered); pickups left 4.
- Run 2: maxLive 71, timeAbove55 48 s, stuck escapes 2, modes engage 2292 /
  emergency 549 / boss 285; dmgBy **bash 10.4k** / sword 5.4k / sword_dance
  3.3k; pickups left 4. Chest spend 87 z (2 chests).
- Run 3: maxLive **166** (horde at t≈240), timeAbove55 151 s, timeAbove100
  69 s, stuck escapes 0, modes engage 2412 / emergency 547 / boss 1693;
  dmgBy bash 13.1k / sword 5.8k / sword_dance 6.3k / magnum 3.2k; chest spend
  173 z (3 chests); pickups left **23** — the field filled with gems the bot
  would not fetch while ring-holding (routing suppressed in boss mode except
  high-value kinds).
- Headed game/wall ratios 0.315 / 0.324 / 0.318 — headed + video costs nothing
  meaningful vs v4 headless (0.268–0.399).

## 5. What the loot-first changes actually did (measured)

- **Loot is measured now.** Every run reports gemExp, zeny earned, chests,
  gear/cards/eggs and loot/min — v4 had none of this. Run 1's 232.2 loot/min
  (gemExp 102.2/min, zeny 90.8/min) is the best loot rate the bot line has
  ever recorded, on a run that died at t=153.
- **Chest opening works.** 6 chests opened across the 3 runs (1/2/3), all
  paid for with farmed zeny; a 3rd chest was opened mid-boss-fight in run 3
  (zeny 97→11). Zeny earned 232/176/272 per run.
- **Loot routing works outside boss mode.** Gems are collected continuously
  (gemExp tracks kills); the headless reference run died with 12 pickups on
  screen vs v4 run 2's 38 — but in boss mode the routing suppression leaves
  23 behind (run 3).
- **The Discovery branch never fired.** Across all v5 runs (smoke, headless,
  headed2, headed3 — 30 picks in the official set, 6 chest pickers), **no
  Elixir of Surprise, Blessing of Plenty, Deity of Avarice/Wisdom, Potion of
  Greed or Potion of Gathering was ever offered**. The only loot-tagged picks
  were AoE (×9, "more kills = more gems") and deities (×3: Executioner,
  Memory, +1). Loot gains came from routing + chests, not Discovery stacking
  — the planner's Discovery scoring is live code, unexercised by offer RNG.
- **Kills/min went DOWN vs v4** (58.6 vs 79.8 mean). Loot routing detours and
  boss-fight time cost kills; run 3's kills/min (45.8) is the lowest of any
  v3/v4/v5 main run despite the longest survival — it spent 1,693 ticks in
  boss mode barely killing.
- **No gear/cards/eggs in 551 kills.** At the bundle's rates (gear capped
  per run, cards 0.01% normal / 0.1% boss, eggs 0.1% / 0.01%) this is
  unsurprising for ~200-kill runs that never kill a boss — boss kills are
  where the rare loot lives, which is exactly why the Eclipse kill matters
  for the loot goal, not just the clear goal.

## 6. The v5.0 → v5.1 story (two live failures, both in the log)

**v5.0 deadlock (headed2 run 1, killed by me at t=198 after the evidence was
conclusive).** The outrange ring worked *too* well: 48 game-s of Eclipse
fight, **0 boss damage, bot at FULL HP (152/152) the whole time, kills flat
at 171**. Mechanism: out of range the boss never casts, so its skills sit
ready forever and `minReady` never exceeds 1.0 s — the burn window the code
waits for cannot open. The bot also fled every add <150 px, so it farmed
nothing either. Perfect survival, zero output. The deadlock is intermittent,
not absolute: the headless v5.0 run 1 (reference only) *did* get burns —
Eclipse 3400→2882 (518 damage) over its 37-s fight, dying at t=187 with 8 HP
at 49 px from the boss — because there the bot was in range at/after spawn
and the boss cast, opening windows. When the bot holds the ring cleanly from
spawn, as in headed2, no cast ever happens and no window ever opens.
(Smoke run: 89.7 s, Lv 6, loot/min 198.6, alive at cap.)

**v5.1 bait-cast (applied mid-task, same precedent as v4.1).** If no burn
window fires for >8 game-s and HP >60%, dive inside skill range to *force* a
cast; the cast puts the skill on cooldown and opens a real burn window. Adds
in the ring are farmed, not fled, while the boss is out of range. Result:
run 2 dealt **1,706** Eclipse damage (3400→1694, first time any v5 run hurt
a boss), run 3 dealt **2,104** (3400→1296, 62% — the most boss damage the bot
line has ever dealt; v4's best was 995).

**What killed v5.1.** Run 1 died before bait could fire (spawn burst at
110 HP, 4 game-s). Run 2 died *in* the burn: at 8 px from Eclipse, HP 16,
nearest enemy 8 px, 70 live — it stayed in past the point of no return.
Run 3 survived the burns at 7 HP (level-up heals), but then could not
re-engage (HP below the 35% burn gate), could not thin the pack (kills flat
~200 for 30+ game-s), and the t≈240 horde (166 live) finished it at t≈270.

## 7. Headed runs, video, screenshots (Araso's live-viewing requirement)

- **Headed:** all 3 official runs ran headed under `xvfb-run` (Xvfb screen
  1280×800). Game/wall 0.315–0.324 — v4's claim that headed ≈ headless held.
- **Video** (`bot/logs-v5/videos/`, 381 MB total, Playwright `.webm` per run,
  matched by file birth time to run end):
  - `e71123faa3bdd2ef02381f5d3407e087.webm` (70 MB) — headed3 run 1 (t=153)
  - `37894b7beccf3d57036c18cc265490a9.webm` (80 MB) — headed3 run 2 (t=167,
    the 1,706-damage Eclipse burn)
  - `e260350d3a52148a2ab5aac70727a40a.webm` (109 MB) — headed3 run 3 (t=270,
    the 2,104-damage Eclipse burn, longest run)
  - `7ea7b18b2b1fd464caa4e73f10b22e02.webm` (130 MB) — headed2 run 1, the v5.0
    deadlock run (t=198, killed by the operator after the evidence was in)
  - `fde0b5595d0027ad468d9154fc420e25.webm` (11 MB) — first headed attempt,
    killed by a VM reboot at 19:02 UTC (t=7 s; see §8)
- **Screenshots** (`bot/logs-v5/screenshots/`, 111 files): stage-transition
  shots per run plus a periodic shot every 60 s wall during play
  (`…-rN-t<game-s>s.png`); 59 shots belong to the headed3 batch, including
  `…-r1/r2/r3-gameover.png`.
- **Ops incidents:** VM reboot at ~19:02 UTC killed the first headed batch
  (uptime reset to 1 min; same failure v3/v4 hit); the batch was relaunched
  and completed. One earlier headless smoke run failed at splash
  ("#sp-play never enabled within 600s", then target crashed); the retry
  worked — flaky startup, not a bot bug (patched bundle parses clean).

## 8. Acceptance — NOT reached (honest)

| Bar | Result |
|---|---|
| Prontera 900 s clear + Mastering kill | **No.** 0/3 clears; best 270 s (30%); Mastering never spawned; Eclipse never killed (best 62% in run 3) |
| Loot/min clearly above v4's | **Cannot be claimed.** v4 recorded no loot number. On the only comparable proxy, kills/min, v5 (58.6) is *below* v4 (79.8). v5's measured loot/min mean is 207.2 — the first real number, not a beating of v4's |
| 3 full headed Prontera runs | **Yes** — 3 headed runs with video + screenshots (plus 2 headless/smoke reference runs and 2 killed headed runs) |

## 9. The new binding constraint

**HP economy through the Eclipse fight, with a pack at density cap that the
bot cannot thin while burning.** The fight now has three phases the bot
cannot chain: (1) enter the fight healthy — runs 1–2 entered at 110/138 and
137/137 after pre-spawn encirclement (stuck escapes, kills flat); (2) burn
without dying — a burn costs ~120 HP (91→14 run 3, 137→16 run 2) while adds
close in, and the bot has no disengage rule (it burns until the window closes
or it dies); (3) recover and re-engage — at 7–40 HP the burn gate (35%) locks
it out, level-up heals are the only recovery, and kills flatline so no gems/
meat arrive. Secondary: boss-mode loot routing leaves 23 pickups uncollected
(run 3) — gems farmed during the fight are left on the field.

Next step (v5.2, specified — not attempted): burn in *budgeted* bursts —
dive only when live enemies <40 (thin first, e.g. with Magnum/Sword Dance
before the boss spawns) and disengage to the ring at HP <50% *during* a burn
instead of waiting for the window to close; after a burn, route to the
nearest meat/gem cluster before the next dive; treat the pre-spawn
encirclement (stuck escapes at t≈140) as the real fight start — if density
is ≥55 at t=140, kite out and thin instead of walking into the spawn.

## 10. What was NOT done / not verified

- No Prontera clear, no Mastering kill, no Toad/Dragon Fly/Vocal fight.
- No Discovery/zeny/pickup loot pick was ever offered, so that whole planner
  branch is unproven live (code only).
- No gear/card/egg dropped in the 3 official runs (0 in 551 kills).
- Culverts / Sunken Ship never attempted (ladder code untested live).
- The `xpPerGameMin` proxy is still broken (98 / 13.3 / 21.9) — use
  `gemExpPerMin` instead; it is the reliable loot signal.
- The v5.0 headless run 1 and headed2 run 1 are reference data only, not
  part of the official 3-run set.

## 11. Files

- `bot/bot5.js` — v5 bot (v5.0 loot-first + v5.1 bait-cast; `bot4.js` untouched)
- `bot/README.md` — v5 section
- `bot/logs-v5/` — `main-headed3.log` (official 3-run batch),
  `main-headed2.log` (v5.0 deadlock run), `main.log` (headless v5.0 run 1),
  `smoke.log` (failed splash), `smoke2.log` (validation run),
  `summary-2026-11-10T19-25-31.json` (official results),
  `runs-2026-11-10T19-25-31.jsonl`, `screenshots/` (111),
  `videos/` (5 × .webm, 381 MB)
- `loot-spec.md` — loot inventory (all sources, rates, chest catalogue,
  Discovery formula, v4 baseline)
- `rea/patch.py` — snapshot extended (loot counters); patched bundle
  sha256 `55cd07b9…` (anchors asserted exactly-once)
- `rea/live-snapshot.json` — last live in-run snapshot (v5 fields)
