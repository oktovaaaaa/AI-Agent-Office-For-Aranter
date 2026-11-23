"""Karakter agen Aranter HQ -> assets/agents.glb (+ blender/agents.blend)

Jalankan:
  "C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe" -b --factory-startup --python blender/build_agents.py

Struktur tiap karakter (dibaca js/agents.js, dianimasikan secara prosedural di web):
  AGENT_<id>            root (kaki di y=0, menghadap +z web)
   └ <id>_body          naik-turun saat berjalan
      ├ <id>_torso      mesh badan
      ├ <id>_legL/_legR pivot pinggul (rotasi x = melangkah)
      ├ <id>_armL/_armR pivot bahu  (rotasi x = mengayun / mengetik)
      └ <id>_head       pivot leher (rotasi y = menoleh)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Builder, empty, export_glb, mat, reset, save_blend  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets", "agents.glb"))
BLEND = os.path.join(HERE, "agents.blend")
PI = math.pi

reset()

SKINS = ["#e0ac69", "#c68642", "#d9a066", "#8d5524", "#f1c27d"]
# id: (baju, celana, kulit, rambut, gaya rambut, aksesoris)
AGENTS = {
    "guard": ("#1e3a8a", "#1f2937", 1, "#111111", "short", ["police", "badge"]),
    "hunter": ("#b45309", "#374151", 0, "#111111", "short", ["hood"]),
    "scanner1": ("#0ea5e9", "#2d3142", 2, "#2b1d14", "spiky", ["lanyard"]),
    "scanner2": ("#6366f1", "#2d3142", 4, "#111111", "long", ["lanyard"]),
    "scanner3": ("#14b8a6", "#2d3142", 1, "#4a2c18", "short", ["lanyard", "glasses"]),
    "scanner4": ("#8b5cf6", "#2d3142", 0, "#2b1d14", "bun", ["lanyard"]),
    "scanner5": ("#06b6d4", "#2d3142", 3, "#111111", "spiky", ["lanyard"]),
    "scanner6": ("#3b82f6", "#2d3142", 2, "#4a2c18", "short", ["lanyard", "headset"]),
    "smc": ("#16a34a", "#1f2937", 0, "#2b1d14", "short", ["glasses"]),
    "donalt": ("#ca8a04", "#3f3f46", 4, "#6b3e1f", "long", []),
    "macd": ("#dc2626", "#1f2937", 1, "#111111", "spiky", ["glasses"]),
    "scalp": ("#9333ea", "#27272a", 2, "#3b2a1a", "bun", []),
    "manager": ("#111827", "#111827", 0, "#3b2a1a", "short", ["tie", "jacket"]),
    "courier": ("#25d366", "#1e3a8a", 3, "#111111", "short", ["cap", "bag"]),
    "tech": ("#475569", "#1f2937", 1, "#2b1d14", "spiky", ["headset", "vest"]),
    "archivist": ("#a16207", "#44403c", 4, "#9ca3af", "bald", ["glasses", "cardigan"]),
    "research": ("#0f172a", "#1e293b", 2, "#111111", "long", ["glasses", "hoodie_ai"]),
    # karakter yang dimainkan pengunjung (mode Jalan / Mata)
    "player": ("#f8fafc", "#1f2937", 0, "#2b1d14", "short", ["lanyard"]),
}

M_SHOE = mat("Shoe", "#1b1b1b", 0.5)
M_EYE = mat("EyeWhite", "#fafafa", 0.3)
M_PUPIL = mat("Pupil", "#121212", 0.2)
M_MOUTH = mat("Mouth", "#7a3b2e", 0.6)
M_METAL = mat("AccMetal", "#c0c6d0", 0.3, 0.8)
M_GOLD = mat("Gold", "#f5c542", 0.3, 0.9)
M_DARK = mat("AccDark", "#151820", 0.5)
M_RED = mat("TieRed", "#dc2626", 0.5)
M_WHITE = mat("ShirtWhite", "#f8fafc", 0.6)
M_GLOW = mat("AiGlow", "#38bdf8", 0.3, emit="#38bdf8", emit_strength=2.5)
M_WA = mat("WaGreen", "#25d366", 0.5)
M_VEST = mat("VestOrange", "#f97316", 0.6)
M_BELT = mat("Belt", "#2a1f17", 0.5)


def build_agent(aid, spec, slot):
    shirt_hex, pants_hex, skin_i, hair_hex, hair_style, acc = spec
    shirt = mat(f"Shirt_{aid}", shirt_hex, 0.75)
    pants = mat(f"Pants_{pants_hex}", pants_hex, 0.8)
    skin = mat(f"Skin_{skin_i}", SKINS[skin_i], 0.55)
    hair = mat(f"Hair_{hair_hex}", hair_hex, 0.6, double=True)

    root = empty(f"AGENT_{aid}", (slot * 1.6, 0, 0))  # dijajarkan di Blender; posisi web diatur JS
    body = empty(f"{aid}_body", (0, 0, 0), parent=root)

    # --- badan
    t = Builder(f"{aid}_torso")
    t.box(shirt, (0.62, 0.62, 0.36), (0, 1.33, 0), bevel=0.08, segs=3)
    t.box(pants, (0.6, 0.22, 0.34), (0, 0.95, 0), bevel=0.06, segs=2)
    t.box(M_BELT, (0.62, 0.06, 0.36), (0, 1.05, 0), bevel=0.02)
    t.box(M_GOLD, (0.08, 0.05, 0.02), (0, 1.05, 0.185))
    t.cyl(skin, 0.09, 0.1, 0.14, (0, 1.68, 0), seg=12)  # leher
    if "tie" in acc or "jacket" in acc:
        t.box(M_WHITE, (0.22, 0.5, 0.02), (0, 1.38, 0.175))
        t.box(M_RED, (0.08, 0.42, 0.025), (0, 1.36, 0.19))
        t.box(M_RED, (0.1, 0.07, 0.03), (0, 1.6, 0.19))
    if "lanyard" in acc:
        t.box(M_DARK, (0.03, 0.35, 0.01), (-0.08, 1.45, 0.185), rot=(0, 0, 0.25))
        t.box(M_DARK, (0.03, 0.35, 0.01), (0.08, 1.45, 0.185), rot=(0, 0, -0.25))
        t.box(M_WHITE, (0.12, 0.16, 0.015), (0, 1.22, 0.19), bevel=0.01)
    if "badge" in acc:
        t.box(M_GOLD, (0.1, 0.12, 0.02), (-0.16, 1.48, 0.185), bevel=0.02)
    if "vest" in acc:
        t.box(M_VEST, (0.64, 0.5, 0.38), (0, 1.36, 0), bevel=0.07)
        t.box(M_METAL, (0.64, 0.04, 0.385), (0, 1.25, 0))
    if "cardigan" in acc:
        t.box(mat("Cardigan", "#78350f", 0.9), (0.2, 0.6, 0.02), (-0.2, 1.33, 0.18))
        t.box(mat("Cardigan", "#78350f", 0.9), (0.2, 0.6, 0.02), (0.2, 1.33, 0.18))
    if "hood" in acc or "hoodie_ai" in acc:
        t.box(shirt, (0.5, 0.18, 0.2), (0, 1.62, -0.16), bevel=0.06)  # tudung terlipat
        t.box(mat(f"Pocket_{aid}", shirt_hex, 0.9), (0.4, 0.16, 0.02), (0, 1.18, 0.185), bevel=0.02)
    if "hoodie_ai" in acc:
        t.box(M_GLOW, (0.2, 0.2, 0.01), (0, 1.42, 0.185), bevel=0.02)  # logo AI menyala
    if "bag" in acc:
        t.box(M_WA, (0.12, 0.7, 0.02), (0, 1.3, 0.19), rot=(0, 0, 0.7))
        t.box(M_WA, (0.42, 0.36, 0.18), (0.3, 1.0, 0.1), bevel=0.05)
        t.box(M_WHITE, (0.3, 0.02, 0.1), (0.3, 1.19, 0.1))
    t.build(parent=body)

    # --- kaki
    for side, sx in (("L", -0.15), ("R", 0.15)):
        piv = empty(f"{aid}_leg{side}", (sx, 0.88, 0), parent=body)
        lg = Builder(f"{aid}_leg{side}_mesh")
        lg.box(pants, (0.22, 0.8, 0.24), (0, -0.42, 0), bevel=0.05)
        lg.box(M_SHOE, (0.24, 0.12, 0.36), (0, -0.82, 0.05), bevel=0.05)
        lg.build(parent=piv)

    # --- lengan
    for side, sx in (("L", -0.4), ("R", 0.4)):
        piv = empty(f"{aid}_arm{side}", (sx, 1.58, 0), parent=body)
        ar = Builder(f"{aid}_arm{side}_mesh")
        sleeve = mat("Jacket", "#111827", 0.7) if "jacket" in acc else shirt
        ar.box(sleeve, (0.17, 0.66, 0.19), (0, -0.3, 0), bevel=0.06)
        ar.sphere(skin, 0.095, (0, -0.68, 0), scale=(1, 1.1, 1), seg=10)
        if side == "L" and aid in ("guard", "manager", "tech"):
            ar.box(M_DARK, (0.19, 0.06, 0.2), (0, -0.56, 0), bevel=0.02)  # jam tangan
        ar.build(parent=piv)

    # --- kepala
    hp = empty(f"{aid}_head", (0, 1.95, 0), parent=body)
    h = Builder(f"{aid}_head_mesh")
    h.sphere(skin, 0.3, (0, 0.02, 0), scale=(1, 1.02, 0.95), seg=20)
    for ex in (-0.11, 0.11):
        h.sphere(M_EYE, 0.06, (ex, 0.04, 0.255), scale=(1, 1.1, 0.45), seg=10)
        h.sphere(M_PUPIL, 0.032, (ex, 0.04, 0.28), scale=(1, 1.1, 0.5), seg=8)
        h.box(mat("Brow", hair_hex if hair_style != "bald" else "#6b7280", 0.8), (0.12, 0.025, 0.03), (ex, 0.14, 0.265),
              rot=(0, 0, -0.12 if ex < 0 else 0.12))
        h.sphere(skin, 0.06, (ex * 2.6, 0.01, 0), scale=(0.6, 1, 0.9), seg=8)  # telinga
    h.sphere(skin, 0.045, (0, -0.03, 0.29), scale=(0.9, 1, 0.9), seg=8)  # hidung
    h.box(M_MOUTH, (0.12, 0.025, 0.02), (0, -0.13, 0.265), bevel=0.008)

    # rambut
    if hair_style != "bald":
        def cap(x, y, z):  # buang bagian wajah & bawah
            return y < -0.05 or (z > 0.12 and y < 0.17)
        h.sphere(hair, 0.32, (0, 0.04, -0.01), scale=(1.0, 0.98, 1.0), seg=20, cut=cap)
    else:
        def ring(x, y, z):
            return y > 0.08 or y < -0.12 or z > 0.05
        h.sphere(hair, 0.31, (0, 0.02, -0.01), seg=16, cut=ring)
    if hair_style == "spiky":
        for k in range(7):
            a = (k - 3) * 0.32
            h.cyl(hair, 0.0, 0.08, 0.22, (math.sin(a) * 0.15, 0.32, math.cos(a) * 0.05 - 0.02), seg=6, rot=(-0.2, 0, -a * 0.6))
    if hair_style == "long":
        h.box(hair, (0.56, 0.5, 0.18), (0, -0.15, -0.16), bevel=0.08)
    if hair_style == "bun":
        h.sphere(hair, 0.13, (0, 0.28, -0.22), seg=12)

    # aksesoris kepala
    if "glasses" in acc:
        for ex in (-0.11, 0.11):
            for (bw, bh, ox, oy) in ((0.15, 0.018, 0, 0.055), (0.15, 0.018, 0, -0.045), (0.018, 0.1, -0.066, 0.005), (0.018, 0.1, 0.066, 0.005)):
                h.box(M_DARK, (bw, bh, 0.015), (ex + ox, 0.04 + oy, 0.3))
        h.box(M_DARK, (0.07, 0.015, 0.015), (0, 0.06, 0.305))
        for ex in (-0.19, 0.19):
            h.box(M_DARK, (0.015, 0.015, 0.25), (ex, 0.06, 0.18))
    if "police" in acc:
        pc = mat("PoliceBlue", "#1e3a8a", 0.5)
        h.cyl(pc, 0.36, 0.31, 0.14, (0, 0.31, -0.02), seg=20)
        h.cyl(M_DARK, 0.32, 0.32, 0.05, (0, 0.25, -0.02), seg=20)
        h.box(M_DARK, (0.38, 0.03, 0.2), (0, 0.235, 0.26), rot=(0.25, 0, 0), bevel=0.01)
        h.box(M_GOLD, (0.09, 0.09, 0.02), (0, 0.31, 0.33), bevel=0.02)
    if "cap" in acc:
        h.sphere(M_WA, 0.325, (0, 0.06, -0.01), seg=18, cut=lambda x, y, z: y < 0.06)
        h.box(M_WA, (0.36, 0.03, 0.24), (0, 0.13, 0.3), rot=(0.12, 0, 0), bevel=0.012)
    if "headset" in acc:
        for k in range(9):
            a = -PI / 2 + k * PI / 8
            h.box(M_DARK, (0.07, 0.04, 0.06), (math.sin(a) * 0.34, 0.06 + math.cos(a) * 0.34, 0), rot=(0, 0, -a))
        for ex in (-0.33, 0.33):
            h.cyl(M_RED if aid == "tech" else M_DARK, 0.08, 0.08, 0.07, (ex, 0.02, 0), seg=12, rot=(0, 0, PI / 2))
        h.box(M_DARK, (0.02, 0.02, 0.2), (0.3, -0.07, 0.12), rot=(0, 0.6, 0))
    if "hood" in acc:
        h.sphere(mat(f"Shirt_{aid}", shirt_hex), 0.35, (0, 0.03, -0.03), seg=16, cut=lambda x, y, z: z > 0.05 or y < -0.2)
    h.build(parent=hp)
    return root


for i, (aid, spec) in enumerate(AGENTS.items()):
    build_agent(aid, spec, i)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
save_blend(BLEND)
export_glb(OUT)
print("agents:", OUT, round(os.path.getsize(OUT) / 1e6, 2), "MB")
