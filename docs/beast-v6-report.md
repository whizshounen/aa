# Beast Bot v6 — ARASO'S FOUR-POINT FIGHT DOCTRINE

**Date:** 2026-11-11 (build `main-DRFCcdKO.js`, patched `dc0c1a8f881a8923`)
**Bot:** `bot/bot6.js` (+ `bot/test_v6.js`, 18/18 unit tests) — Swordsman, Prontera, headless, 640x400, dsf 0.5, 100 ms loop
**Acceptance bar (unchanged):** clear Prontera Fields in 900 s AND kill MVP Mastering, consistently across 3 runs.
**Verdict: ACCEPTANCE NOT REACHED — 0/3 clears. Best run 311.8 s / 900 s (Lv 17). Mastering never seen.**
**But: first Eclipse kill in the whole bot line, and every record broken — kills/min 134 (v5: 58.6), loot/min 654 (v5: 207).**

## What v6 implements (Araso's strategy, verbatim substance)

1. **Mobs — kite-macro, killing ALWAYS first.** Sword band 55–95 px, always moving/strafe, skills auto-fire; the bot only positions. Loot is collected on the way, never at the cost of a kill. Meat: route only when HP is down ≥10%; **exception** — HP <50% + meat within ~20 m (1300 world units ≈ 20 m at ~65 u/m) that the bot can reach WITHOUT dying on the way (projected-HP check: time-to-reach at 150 u/s × speedMult × 0.85 vs incoming contact damage + one budgeted 25-HP graze) → go NOW; if not survivable, do NOT go.
2. **Minis — perfect dodge.** Dodge layer runs FIRST every tick: bossBrain `ready[]` countdowns (hard dodge while a skill is about to land, 1.5 game-s window), `fireRings` (the visible AoE — radial exit), `fxAnchors`, projectiles. While dodging, stay in range of the boss AND the mobs clustered on it, same kite macro.
3. **Mastering — gap-close dodge.** Every dodge is a sidestep (perpendicular), never a retreat; the dodge ends in attack range. Post-cast recovery = dive window. HP <35%: back off to 250–350, farm spawned adds for gems/level-ups (level-ups heal), re-engage at ≥50%.
4. **Power-ups — phase-aware final-boss build.** AoE ×1.3 early (thin the pack), single ×1.1 + sustain ×1.2 mid (150–600 s), single/sustain ×2.0 after t=600 (×2.5 while Mastering is up), AoE ×0.5 late, no new AoE slots after t=600, Discovery collapses late (×0.25, ×0 while Mastering is up). Survival forced when a boss is due within 40 s or HP <50%; +150 sustain when Mastering is due within 60 s; meat card 1000 at HP <35%.

### v6.1 — the live fix that made the Eclipse kill possible
The first official run (v6.0) exposed a structural flaw, found live: the bot sat **540 px from Eclipse doing 2 DPS** (96 boss damage in ~50 s) while 100 adds chewed it to 41% HP. Cause: the miniboss cast dodge shoved the bot **radially out 2.2** on every cast, and the 1.2 close-in could never win the race back. Fix: **cast dodge is a sidestep for EVERY boss** (perp 2.2, radial 0.8 only when deep inside); precast drift never pushes the bot out of the sword band (bd >150 only); **boss mode is killing-first** — adds in sword range get engaged when the boss is >150 px away or the pack is dense (≥55); the disengage still kills adds on the way out; close-in 1.2→1.6 (Mastering 1.2→1.5). Unit tests added for both changes. The fix was validated live in run 2 (Eclipse killed, 61.5 s fight).

### Pick priority (why each choice wins the final boss)
The planner (`scoreCard`) scores every offered card against the phase. Early, AoE (Sword Dance, Magnum Break) wins because a thin pack is what keeps the bot alive to reach the bosses — more kills = more gems = more levels = more HP. Mid-game, single-target (Bash + its Deity, up to +120% damage and bleed 32%) wins because bosses are the wall: Mastering has 52,000 HP and needs ~290 sustained boss DPS; AoE chips nothing off a single boss. Sustain (Endure −24% damage, Life Potion +10% max HP, armor elixirs) wins late because the Mastering fight has no mobs and likely no meat — survival IS the build. Discovery is deprioritised late because the +Discovery report proved it only re-weights quality rolls (Legendary 1.5% → 5.0% at +100%) — it does not raise drop rate, chests, XP or zeny, so it cannot save a boss fight.
**Run 2's actual build (23 counted picks):** Bash → Sword Dance → Magnum Break → Bash Deity Legendary (+20% → +120% dmg, bleed 32%) → Sword Dance Lv 2–5 → Endure (Lv 2–3, boss-due survive ×2.5) → Bash Lv 2–4. Death screen: Bash 9.5k dmg (81 DPS, 42% of total), Attack: Sword 5k, Sword Dance 3.9k, Sword Dance·Deity 2.5k, Magnum 1.5k — **22k total, 136 DPS**.

## Official batch — 3 slots, headless, `--max-seconds=9000 --record-video=true`

| Slot | Run | Time | Lv | Kills | Kills/min | Loot/min | Picks | Cause |
|---|---|---|---|---|---|---|---|---|
| 1 | 2 | 311.8 s | 17 | 697 | **134.1** | **654.2** | 23 | Died — Toad fight |
| 2 | 3 | 173.9 s | 9 | 245 | 84.5 | 250.5 | 10 | Died — Eclipse fight |
| 3 | 4 | 163.7 s | 8 | 176 | 64.5 | 252.9 | 9 | Died — Eclipse fight |

Run 1 (Lv 4, 35 kills, t=49.7 s) is **not** a slot: the renderer died (state-lost) after a `soul_linker` fetch error, and the slot was retried once as run 2 per the v6 harness rule (environment failure, not a run). Sim ratio 0.28–0.34×. Videos: `bot/logs-v6/videos/` — run 2 (Eclipse kill) `1512526a…webm` (1248 s), run 3 `3610b3de…webm`, run 4 `3fc35bb8…webm`. Best run copied to `~/workspace/your_files/beast-v6-run2-best.webm` (129 MB).

## Boss damage per boss

| Boss | Run 2 | Run 3 | Run 4 |
|---|---|---|---|
| **Eclipse** (3,400 HP, t=150) | **KILLED** — 3,350 dmg, kill at t=211.9 s (61.5 s fight) | 1,815 dmg (3,400→1,585), died in fight | 580 dmg (3,400→2,820), died in fight |
| **Toad** (4,600 HP, t=300) | 331 dmg (4,600→4,269), died 11.8 s into fight | never reached | never reached |
| Dragon Fly / Vocal / **Mastering** | never seen | never seen | never seen |

Toad skills (first live capture): Chorro de burbujas cd8/r420, Salto del sapo cd10/r480, Croar cd11/r210, ¡Ranas! cd18/r700.

## Deaths and their cause — the new binding constraint
- **Run 2 (Toad):** entered at 128/143 HP, crashed to 27/143 in ~11 s (nearest 12 px, 25–36 live enemies). Rescue DENIED — meat 184 px away, unsurvivable through the pack.
- **Run 3 (Eclipse):** HP 89/158 → 0 in ~10 s at nearest 6 px, 66 live enemies.
- **Run 4 (Eclipse):** HP 129/137 → 42/137 in ~5 s at nearest 21 px, 70 live enemies. Rescue DENIED — meat 217 px away.
- **Pattern (all three deaths):** the bot does real boss damage now, but it dies to **contact damage while buried in the pack** (nearest < 25 px) during a boss fight — HP falls ~9 HP/s and the meat rescue correctly refuses a run it cannot survive. The dodge layer itself works: casts exposed stayed low (run 2: 15 across the whole run, 0 new ones in the Toad fight; runs 3/4: 7 and 4), and hard dodges fired constantly (run 2: 370 hard / 3120 triggers). Skill hits are not the killer — **the pack is**.
- **Next step (v6.2/v7): pre-boss thinning.** Before each boss spawns (t≈140/290/440/590), force the pack below ~40 live and keep nearest >100 px at spawn; during a boss fight, if nearest <30 px and HP is falling fast, break OUT of the pack (emergency gap) instead of engaging adds in the band — killing adds inside the pack is what gets the bot surrounded.

## Dodge + meat accounting
- Dodge triggers / hard / casts exposed: run 2: 3120 / 370 / 15 · run 3: 1877 / 139 / 7 · run 4: 1375 / 86 / 4.
- Meat rescues attempted / succeeded / denied / eaten: run 2: 23 / 2 / 194 / 16 · run 3: 0 / 0 / 11 / 6 · run 4: 0 / 0 / 26 / 6. (Denials are counted per tick while HP <50% and meat is in range — the gate is strict by design: it refuses runs the projection says the bot will not survive. Run 2's 2 successes came at HP 64→139 via level-up heals around the same time, not from the rescue itself.)
- Eclipse fight HP economy (run 2): entered 137/137 → min 46 → ended 140/140 (level-up heals). The fight is survivable; the Toad fight that followed was not, at the pack density the bot carried into it.

## Loot (v5 loot-first behaviour kept)
- Run 2: **654.2 loot/min** (gemExp 293.2/min, zeny 226.3/min, 7 chests, 1.35 chests/min) — 3.2× v5's 207.2. Runs 3/4: 250.5 / 252.9 (short runs, fewer chests).
- **Gear / cards / eggs: 0 in all runs** (1,118 kills across the 3 counted runs) — same as v5's 0 in 551 kills. No Discovery pick was ever offered in any v6 run either. The loot system still yields only gems/zeny/chests from normal kills.

## Environment notes (why this batch took all day)
- **Two VM reboots** mid-batch (01:54, 02:02 KL) killed two batch attempts; the harness survived both only because every run is logged to disk — the third launch (02:02) completed.
- **Two live game updates in one day:** the main bundle changed `main-B4uIBj7R.js` → `main-C27tKZPx.js` → `main-DRFCcdKO.js`. Re-anchored twice (`rea/patch.py` + `bot/bot6.js` re-pinned; run anchor `z=new Gs(Xa,lr(a),f,Ph(a),v,s),z.charExp=`, plaza `re.setPet(ka(e)&&Yn(ka(e)));` — both held across the second update, only the filename changed). Boot smoke passed on the new build before the batch.
- **Renderer deaths under load:** the bot's Chromium died twice (run 1 of the 02:02 batch at t=49.7 s after a `soul_linker` fetch error; the 01:31 batch died at entry). New in v6: a **state-loss guard** (no snapshot for 30 s wall → loud abort with cause `state-lost`, screenshot attempt, slot retried once) and **browser relaunch** (`ensureBrowser` + `safeRunOne` — a dead browser can no longer kill the whole batch at the next run's `newContext`).
- Sim ratio 0.28–0.34× (post-reboot, quieter machine); the 9000 s cap (raised from 7200 s — the ratio fell to 0.13× under concurrent load) was never the limiter; deaths were.

## Honest limits
- Perfect dodge is measured indirectly (HP economy during boss fights + casts exposed), because the snapshot exposes no "hit by skill X" event. The dodge layer prevents skill hits; it does not prevent contact damage.
- The Eclipse kill is 1 of 3 runs — the boss fight is not yet consistent.
- 900 s win path, Dragon Fly / Vocal / Mastering fights, and co-op are all still unverified.
- Videos are 640×400 headless captures; the sim runs at ~0.3× real time without a GPU.

## Files
- `bot/bot6.js` (v6 + v6.1 + harness), `bot/test_v6.js` (18/18), `bot/README.md` (v6/v6.1/ops notes)
- `bot/logs-v6/summary-2026-11-11T02-02-19.json`, `bot/logs-v6/runs-2026-11-11T02-02-19.jsonl`, `bot/logs-v6/videos/` (9 webms, incl. the 3 official slots), `bot/logs-v6/screenshots/` (182)
- Best run video: `~/workspace/your_files/beast-v6-run2-best.webm` (129 MB, 1248 s)
- `rea/patch.py` (re-anchored to `main-DRFCcdKO.js`), `rea/patched/main-DRFCcdKO.js`
