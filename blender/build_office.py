"""Kantor ARANTER (gaya open-plan modern minimalis) -> assets/office.glb (+ blender/office.blend)

Jalankan (atau pakai build-blender.bat):
  "C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe" -b --factory-startup --python blender/build_office.py

Gaya: karpet abu-abu bergaris, kubikel panel putih + meja kayu oak, planter kayu berisi tanaman,
kursi mesh hitam, dinding kaca dengan pemandangan kota, lampu linear gantung, dinding panel oak + kaca buram.

Konvensi nama yang dibaca web (js/office.js):
  AGENT_HOME_<id>   empty  : posisi berdiri agen, extras.face = arah hadap (rad, sumbu Y web)
  SCREEN_<nama>     empty  : layar dinamis (canvas), extras w, h, yaw, ppu
  POINT_<nama>      empty  : titik tujuan animasi (kartu, jendela, lorong arsip, …)
  LABEL_<n>         empty  : tulisan di lantai, extras text, w
  CABINET_<nn>      mesh   : kabinet arsip per tanggal (bisa diklik, disorot)
  LED_<nn>          mesh   : lampu server berkedip
  material "Glass" / "Frosted" : dibuat transparan di web
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import TAU, Builder, decal, empty, export_glb, make_image, mat, reset, save_blend, tex_mat, text3d  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets", "office.glb"))
BLEND = os.path.join(HERE, "office.blend")
TEX = os.path.join(HERE, "tex")
PI = math.pi
FONT = next((f for f in ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf") if os.path.exists(f)), None)
random.seed(7)

reset()
os.makedirs(TEX, exist_ok=True)


# ---------------------------------------------------------------- tekstur prosedural
def carpet_px():
    rnd = random.Random(3)
    cols = []
    v = 0.5
    for _ in range(256):
        v = min(0.68, max(0.5, v + rnd.uniform(-0.05, 0.05)))
        cols.append(v)
    return lambda x, y: (cols[x] * 0.96, cols[x] * 0.97, cols[x] * 1.0)


def oak_px():
    rnd = random.Random(5)
    phase = [rnd.uniform(0, TAU) for _ in range(8)]

    def f(x, y):
        g = math.sin(y * 0.42 + 2.2 * math.sin(x * 0.018 + phase[0]) + phase[1]) * 0.5 + 0.5
        g2 = math.sin(y * 1.7 + math.sin(x * 0.05 + phase[2]) * 3) * 0.5 + 0.5
        k = 0.86 + 0.09 * g + 0.05 * g2
        return (0.80 * k, 0.60 * k, 0.40 * k)
    return f


carpet_png = make_image(os.path.join(TEX, "carpet_stripe.png"), 256, 64, carpet_px())
oak_png = make_image(os.path.join(TEX, "oak.png"), 256, 256, oak_px())

M = {
    "carpet": tex_mat("CarpetStripe", carpet_png, uv_scale=0.22, rough=0.95, tint="#8a8d93"),
    "oak": tex_mat("Oak", oak_png, uv_scale=0.9, rough=0.55, tint="#c8955f"),
    "corridor": mat("FloorCorridor", "#b9b6b0", 0.8),
    "white": mat("PanelWhite", "#f2f2ef", 0.7), "frame": mat("PanelFrame", "#c9ccd1", 0.5, 0.3),
    "wall": mat("WallWhite", "#ecebe7", 0.9), "mullion": mat("Mullion", "#2b2f36", 0.4, 0.6),
    "glass": mat("Glass", "#cfe6ee", 0.05, alpha=0.18, double=True),
    "frosted": mat("Frosted", "#dfeae2", 0.3, alpha=0.55, double=True),
    "chair": mat("ChairBlack", "#1c1e22", 0.6), "mesh": mat("ChairMesh", "#2a2d33", 0.8),
    "steel": mat("Steel", "#9aa0a8", 0.3, 0.8), "bezel": mat("Bezel", "#101215", 0.35, 0.2),
    "screenOff": mat("ScreenOff", "#14171c", 0.2, emit="#1b2230", emit_strength=0.3),
    "leaf": mat("Leaf", "#3f7f3a", 0.7), "leaf2": mat("Leaf2", "#5a9a46", 0.7), "leaf3": mat("Leaf3", "#2d6a33", 0.7),
    "soil": mat("Soil", "#3b2a1e", 1.0),
    "light": mat("LightBar", "#fffaf0", 0.3, emit="#fff4e0", emit_strength=4.0),
    "fabric": mat("FabricGrey", "#8f949b", 0.95), "fabricDark": mat("FabricDark", "#5f646b", 0.95),
    "rug": mat("Rug", "#d8d4cc", 1.0), "black": mat("Black", "#0c0d10", 0.5),
    "rack": mat("Rack", "#15181d", 0.5, 0.3), "led": mat("Led", "#22c55e", 0.4, emit="#22c55e", emit_strength=3),
    "wa": mat("WhatsApp", "#25d366", 0.4, emit="#25d366", emit_strength=1.0),
    "teal": mat("TealGlow", "#0ea5e9", 0.3, emit="#38bdf8", emit_strength=1.4),
    "mug": mat("Mug", "#f4f4f4", 0.4), "coffee": mat("Coffee", "#3b2414", 0.3),
    "water": mat("Water", "#a5d8f0", 0.05, alpha=0.6),
    "logo": mat("LogoDark", "#1f2328", 0.4, 0.2), "logoGreen": mat("LogoGreen", "#16a34a", 0.4, emit="#22c55e", emit_strength=0.6),
    "cityA": mat("CityA", "#d3dbe2", 0.9), "cityB": mat("CityB", "#e0e6eb", 0.9), "cityC": mat("CityC", "#c6d0d9", 0.9),
    "cityWin": mat("CityWindow", "#e9f2f8", 0.2, emit="#dbeafe", emit_strength=0.25),
}


# ---------------------------------------------------------------- furnitur
def local(x, z, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return lambda lx, ly, lz: (x + lx * c + lz * s, ly, z - lx * s + lz * c)


def workstation(b, x, z, yaw=0.0, w=2.2, d=1.1, side=True):
    """Meja oak + panel kubikel putih (belakang & samping), seperti foto referensi."""
    L = local(x, z, yaw)
    b.box(M["oak"], (w, 0.05, d), L(0, 0.775, 0), yaw=yaw, bevel=0.01)
    b.box(M["white"], (w + 0.1, 1.28, 0.05), L(0, 0.64, -d / 2 - 0.03), yaw=yaw, bevel=0.01)   # panel belakang
    b.box(M["frame"], (w + 0.12, 0.03, 0.07), L(0, 1.295, -d / 2 - 0.03), yaw=yaw)
    if side:
        b.box(M["white"], (0.05, 1.28, d + 0.06), L(w / 2 + 0.05, 0.64, 0), yaw=yaw, bevel=0.01)  # panel samping
        b.box(M["frame"], (0.07, 0.03, d + 0.08), L(w / 2 + 0.05, 1.295, 0), yaw=yaw)
    b.box(M["steel"], (0.05, 0.75, 0.05), L(-w / 2 + 0.08, 0.375, d / 2 - 0.08), yaw=yaw)  # kaki depan
    b.box(M["oak"], (0.4, 0.62, d - 0.1), L(-w / 2 + 0.25, 0.43, 0), yaw=yaw, bevel=0.01)  # laci
    return L


def monitor(b, L, yaw, lx=0.0, lz=-0.22, w=1.0, h=0.6, screen_name=None, ppu=256):
    b.box(M["steel"], (0.26, 0.015, 0.18), L(lx, 0.81, lz), yaw=yaw, bevel=0.004)
    b.box(M["steel"], (0.05, 0.36, 0.04), L(lx, 0.99, lz - 0.03), yaw=yaw)
    b.box(M["bezel"], (w, h, 0.035), L(lx, 1.4, lz), yaw=yaw, bevel=0.008)
    if screen_name:
        px, py, pz = L(lx, 1.4, lz + 0.02)
        empty("SCREEN_" + screen_name, (px, py, pz), w=w - 0.04, h=h - 0.04, yaw=yaw, ppu=ppu)
    else:
        b.box(M["screenOff"], (w - 0.04, h - 0.04, 0.005), L(lx, 1.4, lz + 0.018), yaw=yaw)


def keyboard(b, L, yaw, lx=0.0, lz=0.15):
    b.box(M["black"], (0.45, 0.018, 0.14), L(lx, 0.81, lz), yaw=yaw, bevel=0.005)
    b.box(M["black"], (0.06, 0.02, 0.1), L(lx + 0.34, 0.81, lz), yaw=yaw, bevel=0.008)


def mug(b, L, yaw, lx, lz):
    b.cyl(M["mug"], 0.045, 0.04, 0.1, L(lx, 0.85, lz), seg=12)
    b.cyl(M["coffee"], 0.038, 0.038, 0.005, L(lx, 0.895, lz), seg=12)


def mesh_chair(b, x, z, yaw=0.0):
    L = local(x, z, yaw)
    for i in range(5):
        a = i * TAU / 5
        b.box(M["steel"], (0.05, 0.04, 0.3), L(math.sin(a) * 0.15, 0.07, math.cos(a) * 0.15), yaw=yaw + a)
        b.sphere(M["black"], 0.03, L(math.sin(a) * 0.29, 0.03, math.cos(a) * 0.29), seg=8)
    b.cyl(M["steel"], 0.025, 0.025, 0.36, L(0, 0.28, 0), seg=10)
    b.box(M["chair"], (0.5, 0.07, 0.48), L(0, 0.48, 0), yaw=yaw, bevel=0.03)
    b.box(M["mesh"], (0.46, 0.62, 0.05), L(0, 0.88, 0.24), rot=(-0.1, yaw, 0), bevel=0.04)
    b.box(M["chair"], (0.5, 0.05, 0.07), L(0, 1.2, 0.27), yaw=yaw, bevel=0.02)
    for sx in (-0.27, 0.27):
        b.box(M["chair"], (0.04, 0.22, 0.04), L(sx, 0.6, 0.05), yaw=yaw)
        b.box(M["chair"], (0.06, 0.03, 0.26), L(sx, 0.72, 0.05), yaw=yaw, bevel=0.01)


def bush(b, cx, cy, cz, sx, sz, n=12, s=1.0):
    for i in range(n):
        r = random.uniform(0.12, 0.22) * s
        b.sphere(M[random.choice(("leaf", "leaf2", "leaf3"))], r,
                 (cx + random.uniform(-sx, sx), cy + random.uniform(0.02, 0.2) * s, cz + random.uniform(-sz, sz)),
                 scale=(1.2, 0.8, 1.2), seg=8)
    for i in range(n // 2):  # daun tinggi menjuntai
        a = random.uniform(0, TAU)
        b.sphere(M["leaf2"], 0.08 * s, (cx + math.cos(a) * sx * 0.7, cy + random.uniform(0.25, 0.45) * s,
                                         cz + math.sin(a) * sz * 0.7), scale=(0.7, 2.2, 0.7), seg=6)


def planter(b, x, z, w=0.7, d=1.1, h=1.05, yaw=0.0):
    """Kotak planter kayu oak + tanaman di atasnya."""
    b.box(M["oak"], (w, h, d), (x, h / 2, z), yaw=yaw, bevel=0.015)
    b.box(M["soil"], (w - 0.08, 0.02, d - 0.08), (x, h + 0.005, z), yaw=yaw)
    bush(b, x, h, z, w * 0.42, d * 0.42, n=int(8 + d * 6))


def pot_plant(b, x, z, s=1.0):
    b.cyl(M["white"], 0.26 * s, 0.2 * s, 0.55 * s, (x, 0.275 * s, z), seg=16)
    b.cyl(M["soil"], 0.23 * s, 0.23 * s, 0.02 * s, (x, 0.54 * s, z), seg=16)
    bush(b, x, 0.55 * s, z, 0.18 * s, 0.18 * s, n=9, s=1.3 * s)


def glass_wall(b, x0, z0, x1, z1, h=2.7, material="glass", n_div=2.4):
    dx, dz = x1 - x0, z1 - z0
    ln = math.hypot(dx, dz)
    yaw = math.atan2(-dz, dx)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    b.box(M[material], (ln, h, 0.04), (cx, h / 2, cz), yaw=yaw)
    b.box(M["mullion"], (ln, 0.05, 0.07), (cx, h, cz), yaw=yaw)
    b.box(M["mullion"], (ln, 0.05, 0.07), (cx, 0.025, cz), yaw=yaw)
    n = max(1, int(ln / n_div))
    for i in range(n + 1):
        t = i / n
        b.box(M["mullion"], (0.05, h, 0.07), (x0 + dx * t, h / 2, z0 + dz * t), yaw=yaw)


def light_bar(b, x0, x1, z, y=3.7):
    b.box(M["white"], (x1 - x0, 0.04, 0.08), ((x0 + x1) / 2, y, z), bevel=0.012)
    b.box(M["light"], (x1 - x0 - 0.04, 0.01, 0.06), ((x0 + x1) / 2, y - 0.022, z))
    for xx in (x0 + 0.3, x1 - 0.3):
        b.box(M["steel"], (0.008, 0.5, 0.008), (xx, y + 0.28, z))


def label(n, text, x, z, w=6):
    empty(f"LABEL_{n:02d}", (x, 0.03, z), text=text, w=w)


# ---------------------------------------------------------------- lantai, kaca, dinding
shell = Builder("Office_Shell")
shell.box(M["carpet"], (40, 0.04, 28), (0, -0.02, 0))
shell.box(M["corridor"], (40, 0.02, 1.6), (0, 0.006, -6.9))   # lorong tengah (vinyl terang)
shell.box(M["corridor"], (2.2, 0.02, 6.2), (0, 0.006, 10.9))  # jalur dari pintu masuk
# dinding kaca belakang (pemandangan kota)
glass_wall(shell, -20, -14, 20, -14, h=3.9, n_div=2.5)
shell.box(M["mullion"], (40, 0.3, 0.3), (0, 4.0, -14))
shell.box(M["mullion"], (40, 0.12, 0.25), (0, 0.06, -14))
# dinding kaca kiri
glass_wall(shell, -20, -14, -20, 14, h=3.9, n_div=2.5)
shell.box(M["mullion"], (0.3, 0.3, 28), (-20, 4.0, 0))
# dinding kanan: panel oak + kaca buram (seperti foto)
z = -14.0
k = 0
while z < 14 - 0.01:
    wpanel = 2.4 if k % 3 != 2 else 1.6
    wpanel = min(wpanel, 14 - z)
    shell.box(M["oak"] if k % 3 != 2 else M["frosted"], (0.12, 3.9, wpanel - 0.04), (20, 1.95, z + wpanel / 2), bevel=0.01)
    shell.box(M["mullion"], (0.14, 3.9, 0.04), (20, 1.95, z + wpanel))
    z += wpanel
    k += 1
shell.box(M["mullion"], (0.3, 0.3, 28), (20, 4.0, 0))
# dinding depan rendah (supaya kamera bisa melihat ke dalam)
for x0, x1 in ((-20, -2), (2, 20)):
    shell.box(M["white"], (x1 - x0, 0.55, 0.2), ((x0 + x1) / 2, 0.275, 14), bevel=0.02)
    shell.box(M["oak"], (x1 - x0, 0.04, 0.26), ((x0 + x1) / 2, 0.57, 14))
shell.build()

# kota di luar jendela
city = Builder("City_Skyline")
rnd = random.Random(11)
for i in range(26):
    w, d = rnd.uniform(3, 6), rnd.uniform(3, 6)
    h = rnd.uniform(6, 14)
    x = -36 + i * 3.0 + rnd.uniform(-0.6, 0.6)
    z = rnd.uniform(-48, -30)
    m = M[rnd.choice(("cityA", "cityB", "cityC"))]
    city.box(m, (w, h, d), (x, h / 2 - 9, z))
    for j in range(int(h / 1.4)):
        city.box(M["cityWin"], (w * 0.86, 0.35, 0.02), (x, j * 1.4 - 8.2, z + d / 2 + 0.01))
city.build()

# lampu linear gantung di atas area kerja
lights = Builder("Ceiling_Lights")
for lz in (-1.9, 1.5, 5.0):
    light_bar(lights, -6.5, 8.5, lz)
light_bar(lights, -17.5, -12.5, 3.2)
light_bar(lights, 13, 18.5, 2.2)
light_bar(lights, -17.5, -10.5, -10.5)
lights.build()

# ---------------------------------------------------------------- pintu masuk & resepsionis
ent = Builder("Zone_Entrance")
for sx in (-2, 2):
    ent.box(M["mullion"], (0.12, 3.3, 0.12), (sx, 1.65, 14))
ent.box(M["mullion"], (4.12, 0.14, 0.14), (0, 3.3, 14))
ent.box(M["logo"], (3.8, 1.0, 0.08), (0, 3.85, 14.0), bevel=0.02)  # papan status pasar
empty("SCREEN_sign", (0, 3.85, 14.05), w=3.6, h=0.9, yaw=0.0, ppu=160)
# meja resepsionis putih + top oak
ent.box(M["white"], (3.4, 1.05, 0.9), (-6, 0.525, 12.4), bevel=0.04)
ent.box(M["oak"], (3.6, 0.06, 1.0), (-6, 1.08, 12.4), bevel=0.015)
ent.box(M["oak"], (3.4, 0.05, 0.5), (-6, 0.78, 11.85))
ent.box(M["bezel"], (0.5, 0.32, 0.03), (-6.6, 1.32, 12.1), rot=(0.15, PI, 0), bevel=0.008)
pot_plant(ent, -18.8, 5.8)
pot_plant(ent, 18.6, 12.6)
pot_plant(ent, -3.0, 13.1, 0.8)
pot_plant(ent, 3.0, 13.1, 0.8)
ent.build()
text3d("Logo_Reception", "ARANTER", 0.3, 0.03, (-5.75, 0.4, 12.86), 0.0, M["logo"], FONT, 1.15)
logo_wall = Builder("Logo_Wall_Panel")
for k in range(17):  # dinding bilah kayu oak
    logo_wall.box(M["oak"], (0.2, 2.6, 0.1), (-7.6 + k * 0.2, 1.3, 9.95), bevel=0.01)
logo_wall.box(M["white"], (3.5, 2.6, 0.08), (-6, 1.3, 9.86))
logo_wall.build()
LOGO = os.path.join(TEX, "aranter_logo.png")  # banteng hijau Aranter (dari repo bot docs/Aranter.png)
decal("Logo_Bull_Desk", LOGO, 0.5, 0.5, (-6.95, 0.55, 12.875), 0.0)  # banteng kecil di depan meja resepsionis
decal("Logo_Bull_Reception", LOGO, 0.95, 0.95, (-6, 1.95, 10.015), 0.0)
text3d("Logo_Wall_Front", "ARANTER", 0.4, 0.04, (-6.0, 1.12, 10.0), 0.0, M["logo"], FONT, 1.15)
empty("AGENT_HOME_guard", (-6, 0, 11.35), face=0.0)

# logo besar di dinding oak kanan
decal("Logo_Bull_Wall", LOGO, 1.7, 1.7, (19.92, 2.25, 6.4), -PI / 2)
text3d("Logo_Wall", "ARANTER", 0.75, 0.06, (19.88, 1.95, 8.8), -PI / 2, M["logo"], FONT, 1.15)

# ---------------------------------------------------------------- hunter
hz = Builder("Zone_Hunter")
L = workstation(hz, -15, 3)
monitor(hz, L, 0.0, screen_name="hunter")
keyboard(hz, L, 0.0)
mug(hz, L, 0.0, -0.75, 0.2)
hz.box(M["white"], (0.6, 0.03, 0.45), L(0.75, 0.81, 0.05), bevel=0.01)  # baki kartu
mesh_chair(hz, -15.6, 4.0)
planter(hz, -17.0, 3, w=0.6, d=1.1)
hz.build()
empty("POINT_pile", (-14.2, 0.83, 3.05))
empty("AGENT_HOME_hunter", (-15, 0, 3.95), face=PI)
label(0, "HUNTER · SCREENER", -15, 5.6, 6)

# ---------------------------------------------------------------- ruang scanner (deretan kubikel)
sc = Builder("Zone_Scanner")
i = 0
for z in (-1, 4):
    for x in (-4, 1, 6):
        i += 1
        L = workstation(sc, x, z, side=(x != 6))
        monitor(sc, L, 0.0, screen_name=f"scanner{i}")
        keyboard(sc, L, 0.0)
        if i % 2:
            mug(sc, L, 0.0, -0.8, 0.25)
        mesh_chair(sc, x + 0.8, z + 0.9)
        empty(f"POINT_card_scanner{i}", (x + 0.7, 0.85, z + 0.1))
        empty(f"AGENT_HOME_scanner{i}", (x, 0, z + 0.95), face=PI)
    for px in (-6.55, -1.5, 3.5, 8.55):  # planter di antara kubikel
        planter(sc, px, z, w=0.6, d=1.15)
sc.build()
label(1, "SCANNER · PLAYWRIGHT WORKERS", 1, 6.9, 10)

# ---------------------------------------------------------------- ruang analis (kaca buram)
an = Builder("Zone_Analyst")
glass_wall(an, 11.3, 1.1, 11.3, 8.1, material="frosted")
glass_wall(an, 11.3, -3.8, 11.3, -1.4, material="frosted")
an.cyl(M["white"], 1.6, 1.6, 0.05, (15.6, 0.78, 2.2), seg=48)
an.cyl(M["steel"], 0.06, 0.06, 0.74, (15.6, 0.38, 2.2), seg=12)
an.cyl(M["steel"], 0.5, 0.5, 0.03, (15.6, 0.015, 2.2), seg=24)
for k in range(5):
    a = k * TAU / 5 + 0.3
    an.box(M["white"], (0.28, 0.008, 0.38), (15.6 + math.sin(a) * 0.95, 0.81, 2.2 + math.cos(a) * 0.95), yaw=a)
an.box(M["bezel"], (0.45, 0.015, 0.32), (15.2, 0.815, 1.9), yaw=0.3, bevel=0.005)
an.box(M["bezel"], (0.45, 0.3, 0.015), (15.13, 0.97, 1.76), rot=(-0.3, 0.3, 0), bevel=0.005)
an.box(M["white"], (6.3, 3.6, 0.05), (19.83, 2.1, 2.2), yaw=-PI / 2, bevel=0.02)  # panel layar
empty("SCREEN_whiteboard", (19.79, 2.1, 2.2), w=6.0, h=3.4, yaw=-PI / 2, ppu=110)
an.box(M["oak"], (0.5, 0.75, 4.0), (19.6, 0.375, -1.6), bevel=0.02)  # credenza
pot_plant(an, 19.2, 7.4)
an.build()
empty("POINT_analyst_table", (15.6, 0.9, 2.2))
for aid, ang in (("smc", 0.6), ("donalt", -0.6), ("macd", PI - 0.7), ("scalp", PI + 0.7)):
    empty(f"AGENT_HOME_{aid}", (15.6 + math.sin(ang) * 2.2, 0, 2.2 + math.cos(ang) * 2.2), face=ang + PI)
label(2, "RUANG ANALIS", 15.6, 7.4, 5)

# ---------------------------------------------------------------- lounge VVIP
vp = Builder("Zone_VIP")
glass_wall(vp, -8, -14, -8, -5.6)
glass_wall(vp, -20, -5.6, -12, -5.6)
vp.box(M["bezel"], (8.3, 4.8, 0.1), (-14, 2.2, -13.6), bevel=0.03)  # layar besar (berdiri di depan kaca)
vp.box(M["steel"], (0.1, 0.4, 0.4), (-17, 0.2, -13.6))
vp.box(M["steel"], (0.1, 0.4, 0.4), (-11, 0.2, -13.6))
empty("SCREEN_vipboard", (-14, 2.2, -13.54), w=8.0, h=4.5, yaw=0.0, ppu=110)
vp.cyl(M["rug"], 2.0, 2.0, 0.015, (-12.2, 0.008, -8.8), seg=40)
vp.box(M["fabric"], (3.2, 0.42, 0.95), (-12, 0.27, -7.6), bevel=0.08)  # sofa
vp.box(M["fabric"], (3.2, 0.55, 0.25), (-12, 0.7, -7.2), bevel=0.08)
for sx in (-1.6, 1.6):
    vp.box(M["fabric"], (0.22, 0.6, 0.95), (-12 + sx, 0.4, -7.6), bevel=0.08)
for sx in (-0.75, 0.75):
    vp.box(M["fabricDark"], (1.35, 0.12, 0.75), (-12 + sx, 0.52, -7.65), bevel=0.05)
vp.box(M["oak"], (1.4, 0.05, 0.7), (-12, 0.42, -9.2), bevel=0.015)  # meja kopi
for sx in (-0.6, 0.6):
    for sz in (-0.27, 0.27):
        vp.box(M["steel"], (0.03, 0.4, 0.03), (-12 + sx, 0.2, -9.2 + sz))
mug(vp, lambda a, b, c: (-12 + a, b - 0.39, -9.2 + c), 0.0, 0.3, 0.1)
vp.box(M["oak"], (2.6, 0.7, 0.45), (-18.4, 0.35, -9.0), yaw=PI / 2, bevel=0.02)  # sideboard
pot_plant(vp, -18.4, -11.0, 0.9)
pot_plant(vp, -9.0, -6.4, 0.9)
vp.build()
empty("POINT_vip_card", (-14, 2.2, -13.3))
empty("AGENT_HOME_manager", (-10.5, 0, -9.5), face=-0.6)
label(3, "LOUNGE VVIP · 3 TIMEFRAME", -14, -6.2, 7)

# ---------------------------------------------------------------- kurir WhatsApp
cu = Builder("Zone_Courier")
L = workstation(cu, -1, -10.6)
monitor(cu, L, 0.0, screen_name="courier")
keyboard(cu, L, 0.0)
cu.box(M["wa"], (0.26, 0.18, 0.26), L(0.8, 0.89, 0.2), bevel=0.05)
cu.box(M["oak"], (0.45, 0.12, 0.32), L(-0.75, 0.86, 0.05), bevel=0.015)
for k in range(3):
    cu.box(M["white"], (0.38, 0.008, 0.26), L(-0.75, 0.93 + k * 0.01, 0.05), yaw=k * 0.15)
mesh_chair(cu, -0.2, -9.7)
planter(cu, -2.75, -10.6, w=0.6, d=1.1)
cu.build()
empty("POINT_window", (-1, 2.4, -13.9))
empty("AGENT_HOME_courier", (-1, 0, -9.65), face=PI)
label(4, "KURIR WHATSAPP", -1, -8.5, 5)

# ---------------------------------------------------------------- ruang server (kaca bening)
sv = Builder("Zone_Server")
glass_wall(sv, 4.1, -8.4, 10.9, -8.4)
glass_wall(sv, 4.1, -14, 4.1, -8.4)
for k in range(4):
    rx = 5 + k * 1.6
    sv.box(M["rack"], (1, 2.4, 1), (rx, 1.2, -13.2), bevel=0.02)
    for j in range(8):
        sv.box(M["bezel"], (0.86, 0.2, 0.02), (rx, 0.35 + j * 0.26, -12.69))
sv.box(M["steel"], (6.8, 0.06, 0.4), (7.4, 2.6, -13.2))
sv.build()
n = 0
for k in range(4):
    rx = 5 + k * 1.6
    for j in range(6):
        led = Builder(f"LED_{n:02d}")
        led.box(M["led"], (0.12, 0.05, 0.02), (rx - 0.3 + (j % 3) * 0.3, 0.6 + (j // 3) * 1.2 + (k % 2) * 0.26, -12.67))
        led.build()
        n += 1
empty("AGENT_HOME_tech", (7.5, 0, -11), face=PI)
label(5, "SERVER", 7.5, -9.0, 3.5)

# ---------------------------------------------------------------- arsip (kabinet putih, top oak)
for idx in range(24):
    row, col = divmod(idx, 12)
    x = 12.6 + col * 0.62
    z = -13.4 if row == 0 else -10.6
    cb = Builder(f"CABINET_{idx:02d}")
    cb.box(M["white"], (0.56, 1.45, 0.6), (0, 0.725, 0), bevel=0.01)
    cb.box(M["oak"], (0.58, 0.04, 0.62), (0, 1.47, 0))
    for j in range(3):
        cb.box(M["frame"], (0.5, 0.005, 0.02), (0, 0.5 + j * 0.45, 0.305))
        cb.box(M["steel"], (0.16, 0.025, 0.025), (0, 0.38 + j * 0.45, 0.32))
    cb.build(loc=(x, 0, z))
empty("POINT_archive_entry", (16, 0, -9.2))
empty("POINT_archive_aisle_front", (12.1, 0, -9.2))
empty("POINT_archive_aisle_back", (12.1, 0, -12.1))
empty("AGENT_HOME_archivist", (16, 0, -7.6), face=0.0)
label(6, "ARSIP · history.json", 16, -6.0, 6)

# ---------------------------------------------------------------- riset AI (chatbot analis)
rs = Builder("Zone_Research")
L = workstation(rs, -14.5, 9.6, w=3.0)
monitor(rs, L, 0.0, w=1.25, h=0.72, screen_name="research", ppu=240)
for side in (-1, 1):
    yaw = -side * 0.35
    rs.box(M["bezel"], (0.7, 0.45, 0.03), L(side * 1.02, 1.34, -0.1), yaw=yaw, bevel=0.006)
    rs.box(M["teal"], (0.66, 0.41, 0.005), L(side * 1.02, 1.34, -0.083), yaw=yaw)
    rs.box(M["steel"], (0.04, 0.3, 0.04), L(side * 1.02, 0.98, -0.12), yaw=yaw)
keyboard(rs, L, 0.0)
mug(rs, L, 0.0, 1.1, 0.25)
rs.box(M["rack"], (0.5, 1.2, 0.75), (-16.7, 0.6, 9.5), bevel=0.02)
for j in range(4):
    rs.box(M["teal"], (0.36, 0.025, 0.01), (-16.7, 0.35 + j * 0.25, 9.88))
mesh_chair(rs, -13.6, 10.5)
for sx in (-11.4, -10.2):  # kursi tamu
    rs.box(M["fabric"], (0.8, 0.42, 0.75), (sx, 0.28, 12.3), bevel=0.08)
    rs.box(M["fabric"], (0.8, 0.5, 0.18), (sx, 0.68, 12.62), bevel=0.07)
rs.cyl(M["oak"], 0.3, 0.3, 0.04, (-10.8, 0.5, 11.4), seg=24)
rs.cyl(M["steel"], 0.025, 0.025, 0.48, (-10.8, 0.25, 11.4), seg=8)
rs.cyl(M["water"], 0.16, 0.16, 0.45, (-19.3, 1.32, 8.0), seg=14)
rs.box(M["white"], (0.42, 1.08, 0.42), (-19.3, 0.54, 8.0), bevel=0.03)
planter(rs, -12.55, 9.6, w=0.6, d=1.1)
pot_plant(rs, -18.8, 12.6)
rs.build()
empty("AGENT_HOME_research", (-14.5, 0, 10.55), face=PI)
label(7, "RISET AI · TANYA ANALIS", -14.8, 13.3, 7.5)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
save_blend(BLEND)
export_glb(OUT)
print("office:", OUT, round(os.path.getsize(OUT) / 1e6, 2), "MB")
