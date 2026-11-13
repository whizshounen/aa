#!/usr/bin/env python3
import importlib.util
from pathlib import Path


PATCH = Path(__file__).with_name("patch.py")
spec = importlib.util.spec_from_file_location("ro_patch", PATCH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_run_anchor_includes_char_exp_rhs_before_injection():
    source = (
        "z=new Qs(nn,vr(a),f,iu(a),b,s),"
        "z.serverLoot=NM(a),"
        "z.charExp=new dg(a,{jobCap:u.jobCap,jobExp:u.jobExp,count:1}),"
        "z.look={look:a.look,equip:sa(a)}"
    )
    anchor = module.find_run_anchor(source)
    assert anchor is not None
    assert anchor["match"].endswith("new dg(a,{jobCap:u.jobCap,jobExp:u.jobExp,count:1})")


def test_snapshot_uses_run_time_up_and_exposes_enemy_bosses():
    code = module.snapshot_code("R")
    assert "timeUp:+((R.timeUp||0).toFixed(1))" in code
    assert "timeUp:+((R.nextBoss||0).toFixed(1))" not in code
    assert "R.enemies.filter(t=>!t.dead&&t.def&&t.def.boss" in code


def test_snapshot_exposes_the_live_map_boss_schedule():
    code = module.snapshot_code("R")
    assert "bossSchedule:(R.script&&Array.isArray(R.script.bosses)?R.script.bosses.map" in code


def test_snapshot_exposes_the_live_horde_clock():
    code = module.snapshot_code("R")
    assert "nextHordeAt:+((R.nextHordeAt||0).toFixed(1))" in code
