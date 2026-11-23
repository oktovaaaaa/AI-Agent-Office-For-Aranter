"""Helper bersama untuk script Blender Aranter HQ.

Semua posisi ditulis dalam KOORDINAT WEB (Three.js): x = kanan, y = atas, z = ke arah kamera.
Fungsi V() mengubahnya ke koordinat Blender (Z-up). Exporter glTF (+Y up) mengubahnya kembali,
sehingga angka di script ini = angka yang terbaca di JavaScript.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.tau


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def V(x, y, z):
    """web (x, y-up, z) -> blender (x, -z, y)"""
    return Vector((x, -z, y))


def R(rx=0.0, ry=0.0, rz=0.0):
    """Rotasi Euler dalam sumbu web (rad) -> Matrix 4x4 Blender."""
    return (Matrix.Rotation(ry, 4, V(0, 1, 0)) @ Matrix.Rotation(rx, 4, V(1, 0, 0)) @ Matrix.Rotation(rz, 4, V(0, 0, 1)))


def hexlin(h):
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


_MATS = {}


def mat(name, color, rough=0.8, metal=0.0, emit=None, emit_strength=1.0, alpha=None, double=False):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*hexlin(color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*hexlin(emit), 1)
        b.inputs["Emission Strength"].default_value = emit_strength
    if alpha is not None:
        b.inputs["Alpha"].default_value = alpha
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    m.use_backface_culling = not double
    m.diffuse_color = (*hexlin(color), 1 if alpha is None else alpha)
    _MATS[name] = m
    return m


class Builder:
    """Mengumpulkan banyak primitif (multi-material) menjadi 1 objek mesh."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def _add(self, tmp, m, matrix, smooth=False, smooth_caps=True):
        bmesh.ops.transform(tmp, matrix=matrix, verts=tmp.verts)
        if m not in self.mats:
            self.mats.append(m)
        mi = self.mats.index(m)
        for f in tmp.faces:
            f.material_index = mi
            f.smooth = smooth
        me = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        return self

    def box(self, m, size, pos, rot=None, yaw=0.0, bevel=0.0, segs=2):
        w, h, d = size
        tmp = bmesh.new()
        r = bmesh.ops.create_cube(tmp, size=1.0)
        bmesh.ops.scale(tmp, vec=(w, d, h), verts=r["verts"])
        if bevel > 0:
            edges = list(tmp.edges)
            bmesh.ops.bevel(tmp, geom=list(tmp.verts) + edges, offset=min(bevel, min(size) * 0.45),
                            segments=segs, profile=0.5, affect="EDGES", clamp_overlap=True)
        rot_m = R(*rot) if rot else Matrix.Rotation(yaw, 4, "Z")
        return self._add(tmp, m, Matrix.Translation(V(*pos)) @ rot_m)

    def cyl(self, m, r_top, r_bot, h, pos, seg=16, rot=None, smooth=True):
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=seg, radius1=r_bot, radius2=r_top, depth=h)
        tmp.normal_update()
        if smooth:  # sisi halus, tutup datar
            for f in tmp.faces:
                f.smooth = abs(f.normal.z) < 0.7
        rot_m = R(*rot) if rot else Matrix.Identity(4)
        bmesh.ops.transform(tmp, matrix=Matrix.Translation(V(*pos)) @ rot_m, verts=tmp.verts)
        flags = [f.smooth for f in tmp.faces]
        if m not in self.mats:
            self.mats.append(m)
        mi = self.mats.index(m)
        for f, s in zip(tmp.faces, flags):
            f.material_index = mi
            f.smooth = s
        me = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        return self

    def sphere(self, m, r, pos, scale=(1, 1, 1), seg=16, rot=None, cut=None):
        """cut(vx, vy, vz) -> True untuk menghapus vertex (koordinat web lokal, sebelum skala)."""
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(tmp, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
        if cut:
            kill = [v for v in tmp.verts if cut(v.co.x, v.co.z, -v.co.y)]
            if kill:
                bmesh.ops.delete(tmp, geom=kill, context="VERTS")
        sx, sy, sz = scale
        rot_m = R(*rot) if rot else Matrix.Identity(4)
        mtx = Matrix.Translation(V(*pos)) @ rot_m @ Matrix.Diagonal((sx, sz, sy, 1))
        return self._add(tmp, m, mtx, smooth=True)

    def quad(self, m, w, d, pos, yaw=0.0):
        """Bidang horizontal (lantai/karpet)."""
        tmp = bmesh.new()
        hw, hd = w / 2, d / 2
        vs = [tmp.verts.new(V(x, 0, z)) for x, z in ((-hw, hd), (hw, hd), (hw, -hd), (-hw, -hd))]
        tmp.faces.new(vs)
        return self._add(tmp, m, Matrix.Translation(V(*pos)) @ Matrix.Rotation(yaw, 4, "Z"))

    def build(self, parent=None, loc=(0, 0, 0)):
        # UV proyeksi kotak (box mapping) supaya tekstur karpet/kayu tampil di semua primitif
        self.bm.normal_update()
        uvl = self.bm.loops.layers.uv.verify()
        for f in self.bm.faces:
            m = self.mats[f.material_index] if f.material_index < len(self.mats) else None
            s = float(m.get("uv_scale", 1.0)) if m else 1.0
            n = f.normal
            ax = max(range(3), key=lambda k: abs(n[k]))
            for lp in f.loops:
                c = lp.vert.co
                lp[uvl].uv = ((c.x, c.y) if ax == 2 else (c.y, c.z) if ax == 0 else (c.x, c.z))
                lp[uvl].uv = (lp[uvl].uv[0] * s, lp[uvl].uv[1] * s)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        ob.location = V(*loc)
        return ob


def tex_mat(name, img_path, uv_scale=1.0, rough=0.8, metal=0.0, tint=None):
    """Material bertekstur gambar (PNG). uv_scale = jumlah ulangan per meter."""
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    N, L = m.node_tree.nodes, m.node_tree.links
    b = N.get("Principled BSDF")
    t = N.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(img_path, check_existing=True)
    L.new(t.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m["uv_scale"] = uv_scale
    if tint:
        m.diffuse_color = (*hexlin(tint), 1)
    _MATS[name] = m
    return m


def make_image(path, w, h, fn):
    """Buat PNG prosedural. fn(x, y) -> (r, g, b) 0..1 (sRGB)."""
    img = bpy.data.images.new(os.path.basename(path), w, h)
    px = [0.0] * (w * h * 4)
    for y in range(h):
        for x in range(w):
            r, g, b_ = fn(x, y)
            i = (y * w + x) * 4
            px[i], px[i + 1], px[i + 2], px[i + 3] = r, g, b_, 1.0
    img.pixels = px
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return path


def text3d(name, body, size, depth, pos, yaw, material, font_path=None, spacing=1.0):
    """Huruf 3D berdiri tegak, menghadap arah yaw (0 = +z web). Dikonversi ke mesh."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = depth
    cu.align_x = "CENTER"
    cu.align_y = "BOTTOM"
    cu.space_character = spacing
    if font_path and os.path.exists(font_path):
        cu.font = bpy.data.fonts.load(font_path, check_existing=True)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(material)
    ob.rotation_euler = (math.pi / 2, 0, yaw)
    ob.location = V(*pos)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    return ob


def decal(name, img_path, w, h, pos, yaw=0.0, mat_name="LogoDecal"):
    """Bidang gambar transparan (mis. logo) berdiri tegak, menghadap arah yaw (0 = +z web)."""
    m = bpy.data.materials.get(mat_name)
    if m is None:
        m = bpy.data.materials.new(mat_name)
        try:
            m.use_nodes = True
        except Exception:
            pass
        N, L = m.node_tree.nodes, m.node_tree.links
        b = N.get("Principled BSDF")
        t = N.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(img_path, check_existing=True)
        L.new(t.outputs["Color"], b.inputs["Base Color"])
        L.new(t.outputs["Alpha"], b.inputs["Alpha"])
        b.inputs["Roughness"].default_value = 0.5
        for attr, val in (("surface_render_method", "DITHERED"), ("blend_method", "CLIP")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
        m.use_backface_culling = True
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    hw, hh = w / 2, h / 2
    vs = [bm.verts.new(V(x, y, 0)) for x, y in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]
    f = bm.faces.new(vs)
    for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uvl].uv = uv
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = V(*pos)
    ob.rotation_euler = (0, 0, yaw)
    return ob


def empty(name, pos=(0, 0, 0), parent=None, **extras):
    """Titik penanda (anchor). extras -> userData di Three.js (butuh export_extras=True)."""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "PLAIN_AXES"
    ob.empty_display_size = 0.3
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = V(*pos)
    for k, v in extras.items():
        ob[k] = v
    return ob


def export_glb(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_extras=True, export_yup=True, export_animations=False)


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=path)
