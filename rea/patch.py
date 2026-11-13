#!/usr/bin/env python3
"""Fetch the live RO Survivors bundle, patch it, and record the result.

What the patch does
-------------------
It only EXPOSES read-only state to the bot. It never writes to the run, the
simulation, the character, or the network.

  1. run anchor  (the live run object)
     ... ,F.serverLoot=X(a),F.charExp=        ->  ,F.serverLoot=X(a),
     window.__RO__=F,
     window.__RO_SNAPSHOT__=()=>{ ...plain JSON of the live run... }

  2. plaza anchor (the character in town)
     re.setPet(...);                          ->  re.setPet(...);
     window.__RO_CHAR__=e,
     window.__RO_ITEM__=(id)=>{ ...name/slot/icon of an item... },
     window.__RO_PLAZA_SNAPSHOT__=()=>{ ...character + inventory... }

Why it is written this way
--------------------------
The game renames its minified internals on every deploy (the bundle file name
changes too: main-BNOcv2PN.js -> main-L7-VCOrI.js -> main-WFvHOlDD.js ->
main-Dq84ileb.js). So the anchors are DISCOVERED by pattern, not hardcoded:

  run var    : X=new Cls(...),X.serverLoot=Y(...),X.charExp=
  plaza var  : V.setPet(F(c)&&F(c));
  char var   : the argument of the plaza constructor (has .name)
  equip fn   : the function called with the char right after "e.look,"
  item table : T[item.itemId]
  assets     : A.icons.get(   (the asset manager, it also holds the manifest)

If discovery fails the script does NOT kill the farm: it writes
patched/bundle.json with ok=false and exits 0, and the bot then runs on the
plain live bundle (the farm keeps running, only the inventory detail is
missing).

Usage:  python3 patch.py [--force]
"""

import hashlib
import json
import os
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]          # ~/.local/share/ro-survivors-bot
BUILD = ROOT / "build"
PATCHED = ROOT / "rea" / "patched"
MANIFEST = PATCHED / "bundle.json"
SITE = "https://ro-survivors.com/"


def log(msg):
    print(f"[patch] {msg}", flush=True)


def fetch(url, binary=False):
    # curl, not urllib: this box reaches the site through curl fine, while
    # urllib stalls (IPv6 / TLS path).
    import subprocess
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp_path = tmp.name
    try:
        subprocess.run(["curl", "-sL", "--max-time", "180", "-o", tmp_path, url],
                       check=True, timeout=200)
        data = pathlib.Path(tmp_path).read_bytes()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    return data if binary else data.decode("utf-8", "ignore")


def sha256(data):
    if isinstance(data, str):
        data = data.encode("utf-8", "ignore")
    return hashlib.sha256(data).hexdigest()


# --------------------------------------------------------------------------
# anchor discovery
# --------------------------------------------------------------------------
def find_run_anchor(src):
    """X=new Cls(...),X.serverLoot=Y(...),X.charExp=<rhs>"""
    pat = re.compile(
        r"([A-Za-z_$][\w$]*)=new ([A-Za-z_$][\w$]*)\((.{0,200}?)\),\1\.serverLoot=([A-Za-z_$][\w$]*)\((.{0,80}?)\),\1\.charExp=(.{0,1000}?)(?=,\1\.look=)"
    )
    m = pat.search(src)
    if not m:
        return None
    return {
        "run": m.group(1),
        "cls": m.group(2),
        "args": m.group(3),
        "loot": m.group(4),
        "lootArgs": m.group(5),
        "charExp": m.group(6),
        "match": m.group(0),
        "start": m.start(),
        "end": m.end(),
    }


def find_plaza_anchor(src, run):
    """V.setPet(F(c)&&G(c));  plus the character variable of the plaza."""
    pat = re.compile(
        r"([A-Za-z_$][\w$]*)\.setPet\(([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)&&[^;]{0,60}\);"
    )
    for m in pat.finditer(src):
        plaza = m.group(1)
        # the character is the argument of the plaza constructor:
        #   const i=V=new Cls(map,fn(c),look,c.name,nn)
        back = src[max(0, m.start() - 800):m.start()]
        cm = list(re.finditer(r"([A-Za-z_$][\w$]*)\.name[,)]", back))
        if not cm:
            continue
        char = cm[-1].group(1)
        # the equip function: called with the char right after "<char>.look,"
        eq = None
        for em in re.finditer(r"\.look,([A-Za-z_$][\w$]*)\(", back + src[m.start():m.start() + 200]):
            eq = em.group(1)
        return {
            "plaza": plaza,
            "char": char,
            "equip": eq,
            "match": m.group(0),
            "start": m.start(),
            "end": m.end(),
        }
    return None


def find_item_table(src):
    for m in re.finditer(r"([A-Za-z_$][\w$]*)\[[A-Za-z_$][\w$]*\.itemId\]", src):
        return m.group(1)
    return None


def find_assets(src):
    for m in re.finditer(r"([A-Za-z_$][\w$]*)\.icons\.get\(", src):
        return m.group(1)
    return None


# --------------------------------------------------------------------------
# the injected code
# --------------------------------------------------------------------------
def snapshot_code(run):
    """Read-only snapshot of the live run. Only uses window.__RO__ and the
    run's own field names, so it survives a rename of the game's locals."""
    return (
        "window.__RO__=" + run + ",\n"
        "window.__RO_SNAPSHOT__=()=>{try{const R=window.__RO__;if(!R)return null;"
        "const T=t=>t?{x:Math.round(t.x),y:Math.round(t.y),hp:Math.round(t.hp),maxHp:Math.round(t.maxHp),"
        "id:t.def?t.def.id:null,name:t.def?t.def.name:null,boss:!!(t.def&&t.def.boss),group:t.def?t.def.group:null,"
        "elite:!!t.elite,dead:!!t.dead,damage:Math.round(t.damage||0),state:t.state||null,"
        "speed:t.def?Math.round((t.def.speed||0)*100)/100:null,radius:t.def?Math.round(t.def.radius||0):null,"
        "bornAt:t.bornAt?Math.round(t.bornAt*10)/10:null,fused:!!t.fused}:null;"
        "return{ok:!0,stage:R.stageId,state:R.state,time:+R.time.toFixed(2),ticks:R.ticks,level:R.level,"
        "hp:Math.round(R.hp),maxHp:R.stats?Math.round(R.stats.maxHp):0,exp:R.exp,expNext:R.expNext,kills:R.kills,"
        "zeny:R.zeny,seed:R.seed,deterministic:!!R.deterministic,bounds:R.bounds,"
        "player:{x:Math.round(R.player.x),y:Math.round(R.player.y),dead:!!R.player.dead,moving:!!R.player.moving},"
        "enemies:R.enemies.filter(t=>!t.dead).map(T),enemiesDead:R.enemies.filter(t=>t.dead).length,"
        "pickups:R.pickups.filter(t=>!t.dead).map(t=>({kind:t.kind,x:Math.round(t.x),y:Math.round(t.y),value:t.value??null,quality:t.quality??null})),"
        "projectiles:R.projectiles.filter(t=>!t.dead).map(t=>({x:Math.round(t.x),y:Math.round(t.y),vx:+(t.vx||0).toFixed(1),vy:+(t.vy||0).toFixed(1),life:+(t.life||0).toFixed(2)})),"
        "bosses:[...R.bosses.filter(t=>!t.dead),...R.enemies.filter(t=>!t.dead&&t.def&&t.def.boss&&!R.bosses.includes(t))].map(T),"
        "fireRings:R.fireRings.map(t=>({x:Math.round(t.x),y:Math.round(t.y),r:Math.round(t.r),until:+((t.until||0).toFixed(1))})),"
        "fxAnchors:R.fx.filter(t=>t.anchor).map(t=>({x:Math.round(t.anchor.x),y:Math.round(t.anchor.y)})).slice(0,40),"
        "meteorsOn:!!R.meteorsOn,meteorAcc:+((R.meteorAcc||0).toFixed(2)),nextBoss:R.nextBoss,bossSchedule:(R.script&&Array.isArray(R.script.bosses)?R.script.bosses.map(s=>({id:s.id,t:+(s.t||0).toFixed(1)})):[]),timeUp:+((R.timeUp||0).toFixed(1)),"
        "closeAt:R.closeAt,lootUntil:R.lootUntil,pendingLevelUps:R.pendingLevelUps,bossKills:R.bossKills,"
        "mvpsKilled:R.mvpsKilled,chestsOpened:R.chestsOpened,"
        "runLoot:[...(R.runLoot||[])].map(t=>({id:t.id,quality:t.quality,ilvl:t.ilvl,tier:t.tier})),"
        "mobLoot:R.mobLoot,runCards:[...(R.runCards||[])],runEggs:[...(R.runEggs||[])],"
        "nextEliteAt:+((R.nextEliteAt||0).toFixed(1)),nextHordeAt:+((R.nextHordeAt||0).toFixed(1)),mvpUntil:R.mvpUntil,"
        "bossBrains:[...R.bossBrains].map(([t,n])=>({boss:t.def?t.def.id:null,hp:Math.round(t.hp),maxHp:Math.round(t.maxHp),"
        "phase:t.phase,gcd:+((t.gcd||0).toFixed(2)),busyUntil:+((t.busyUntil||0).toFixed(1)),"
        "skills:(n.skills||[]).map(o=>({name:o.name,cd:o.cd,range:o.range})),ready:(n.ready||[]).map(r=>+r.toFixed(1))})),"
        "dmgBy:R.dmgLog&&R.dmgLog instanceof Map?Object.fromEntries([...R.dmgLog].map(([k,v])=>[k,"
        "v instanceof Map?Object.fromEntries(v):(v&&typeof v==='object'?JSON.parse(JSON.stringify(v)):v)])):(R.dmgLog||{}),"
        "killsBy:R.killsBy&&R.killsBy instanceof Map?Object.fromEntries(R.killsBy):(R.killsBy||{}),"
        "stats:R.stats?{speedMult:+((R.stats.speedMult||0).toFixed(3)),damageMult:+((R.stats.damageMult||0).toFixed(3)),"
        "discovery:+((R.stats.discovery||0).toFixed(3)),pickupRadius:Math.round(R.stats.pickupRadius||0),"
        "maxHp:Math.round(R.stats.maxHp||0),critChance:+((R.stats.critChance||0).toFixed(3))}:null,"
        "weapons:(R.weapons||[]).map(t=>t.id||t.name||String(t)),equip:(R.look&&R.look.equip)||null,"
        "slots:R.slots,passives:[...R.passives.keys()],buffs:[...R.buffs.keys()]}}catch(t){return{ok:!1,error:String(t)}}},\n"
    )


def plaza_code(pla, items, assets):
    """Read-only snapshot of the character + an item lookup helper."""
    equip = pla.get("equip")
    equip_expr = (equip + "(" + pla["char"] + ")") if equip else "null"
    return (
        "window.__RO_CHAR__=" + pla["char"] + ",\n"
        "window.__RO_ITEM__=(id)=>{try{const A=" + assets + ";const m=(A&&A.manifest&&A.manifest.items)?A.manifest.items[id]:null;"
        "const t=" + items + "[id];return{id:Number(id),name:m&&m.name?m.name:null,"
        "slot:t&&t.slot?t.slot:(m&&m.slots!==undefined?m.slots:null),rare:!!(t&&t.rare),"
        "icon:m&&m.icon?(location.origin+'/assets/'+m.icon):null}}catch(t){return null}},\n"
        "window.__RO_PLAZA__=" + pla["plaza"] + ",\n"
        "window.__RO_PLAZA_SNAPSHOT__=()=>{try{const P=window.__RO_PLAZA__;if(!P)return null;"
        "const pr=(x,y)=>{try{const s=P.world3d.project(x,y);return{x:Math.round(s.x),y:Math.round(s.y)}}catch(t){return null}};"
        "return{ok:!0,player:{x:Math.round(P.player.x),y:Math.round(P.player.y),screen:pr(P.player.x,P.player.y)},"
        "npcs:(P.npcs||[]).map(t=>({id:t.id,name:t.name,x:Math.round(t.x),y:Math.round(t.y),screen:pr(t.x,t.y)})),"
        "near:P.near?P.near.id:null,talkTo:P.talkTo?P.talkTo.id:null,"
        "overlays:[...document.querySelectorAll('.overlay:not(.hidden)')].map(t=>t.id),"
        "activeTag:document.activeElement?document.activeElement.tagName+'#'+(document.activeElement.id||''):'none',"
        "char:(()=>{try{const c=window.__RO_CHAR__;if(!c)return null;return{ok:!0,name:c.name,job:c.job,level:c.level,"
        "jobLevel:c.jobLevel,equip:" + equip_expr + ","
        "inventory:(c.inventory||[]).map(x=>{const it=window.__RO_ITEM__(x.itemId);"
        "return{uid:x.uid,itemId:x.itemId,count:x.count??1,ilvl:x.ilvl??null,quality:x.quality??null,"
        "name:it&&it.name||null,slot:it&&it.slot||null,icon:it&&it.icon||null}})}}catch(t){return{ok:!1,error:String(t)}}})()}}"
        "catch(t){return{ok:!1,error:String(t)}}};\n"
    )


# --------------------------------------------------------------------------
def main():
    force = "--force" in sys.argv
    BUILD.mkdir(parents=True, exist_ok=True)
    PATCHED.mkdir(parents=True, exist_ok=True)

    # 1. which bundle is live?
    index = fetch(SITE)
    m = re.search(r"build/(main-[A-Za-z0-9_-]+\.js)", index)
    if not m:
        log("could not find the live bundle name in index.html")
        write_manifest({"ok": False, "reason": "live bundle name not found in index.html", "at": now()})
        return 0
    name = m.group(1)
    src_path = BUILD / name
    patched_path = PATCHED / name

    # 2. is the patched file for this bundle already current?
    prev = read_manifest()
    if (not force and prev.get("ok") and prev.get("name") == name
            and patched_path.exists() and src_path.exists()
            and prev.get("srcSha") == sha256(src_path.read_text(errors="ignore"))):
        log(f"already patched: {name} (sha {prev.get('srcSha', '')[:8]})")
        return 0

    # 3. download the live bundle
    log(f"downloading {name}")
    raw = fetch(SITE + "build/" + name)
    src_path.write_text(raw)
    src = raw
    log(f"source sha256={sha256(src)[:12]} len={len(src)}")

    # 4. discover the anchors
    run = find_run_anchor(src)
    if not run:
        log("run anchor not found (the game renamed its internals again)")
        write_manifest({"ok": False, "name": name, "reason": "run anchor not found", "at": now()})
        return 0
    pla = find_plaza_anchor(src, run)
    items = find_item_table(src)
    assets = find_assets(src)
    if not pla or not items or not assets:
        log(f"incomplete anchors (plaza={bool(pla)} items={items} assets={assets})")
        write_manifest({"ok": False, "name": name, "reason": "plaza/item/asset anchor not found", "at": now()})
        return 0
    log(f"anchors: run={run['run']} plaza={pla['plaza']} char={pla['char']} equip={pla['equip']} items={items} assets={assets}")

    # 5. inject
    out = src
    # Inject only after the complete charExp assignment. Injecting after the
    # old anchor's `charExp=` changed the comma expression and assigned the
    # run object to charExp, causing the game's `charExp.kill()` to crash.
    out = out.replace(
        run["match"] + ",",
        run["match"] + ";\n" + snapshot_code(run["run"]),
        1,
    )
    out = out.replace(pla["match"], pla["match"] + "\n" + plaza_code(pla, items, assets), 1)
    patched_path.write_text(out)
    log(f"patched -> {patched_path} sha256={sha256(out)[:12]} len={len(out)}")

    # 6. record it for the bot
    write_manifest({
        "ok": True,
        "name": name,
        "srcSha": sha256(src),
        "patchedSha": sha256(out),
        "anchors": {"run": run["run"], "plaza": pla["plaza"], "char": pla["char"],
                    "equip": pla["equip"], "items": items, "assets": assets},
        "at": now(),
    })
    return 0


def now():
    import time
    return int(time.time() * 1000)


def read_manifest():
    try:
        return json.loads(MANIFEST.read_text())
    except Exception:
        return {}


def write_manifest(data):
    PATCHED.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(data, indent=2))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        # Never kill the farm because of a patch problem: record it and let
        # the bot run on the plain live bundle.
        log(f"ERROR: {e}")
        try:
            write_manifest({"ok": False, "reason": str(e)[:300], "at": now()})
        except Exception:
            pass
        sys.exit(0)
