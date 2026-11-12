#!/usr/bin/env python3
"""Generate crisp supersampled iOS/iPadOS Home Screen icons, manifest.webmanifest, and offline sw.js."""
import base64
import io
import json
import os
from PIL import Image, ImageDraw

BASE_DIR = "/home/antigravity/cele-ambush"
ICONS_DIR = os.path.join(BASE_DIR, "icons")
os.makedirs(ICONS_DIR, exist_ok=True)


def draw_master_icon(size=1024, maskable=False):
    img = Image.new("RGBA", (size, size), (11, 17, 24, 255))  # #0b1118
    draw = ImageDraw.Draw(img)

    pad = int(size * (0.14 if maskable else 0.07))
    inner = size - 2 * pad

    # Subtle tactical card frame
    if not maskable:
        draw.rounded_rectangle(
            [pad, pad, size - pad, size - pad],
            radius=int(size * 0.18),
            fill=(17, 26, 36, 255),
            outline=(49, 71, 96, 255),
            width=max(4, size // 96),
        )

    # Blueprint grid lines
    grid_step = inner // 6
    grid_color = (26, 41, 58, 255)
    for i in range(1, 6):
        x = pad + i * grid_step
        y = pad + i * grid_step
        draw.line([(x, pad + 20), (x, size - pad - 20)], fill=grid_color, width=max(2, size // 256))
        draw.line([(pad + 20, y), (size - pad - 20, y)], fill=grid_color, width=max(2, size // 256))

    # Outer Spiral Retention Arc (Gold #eab308) & Primary Frontier Arc (Cyan #0ea5e9)
    arc_margin = int(size * (0.21 if maskable else 0.16))
    arc_box = [arc_margin, arc_margin, size - arc_margin, size - arc_margin]
    arc_w = max(12, size // 26)
    draw.arc(arc_box, start=135, end=345, fill=(14, 165, 233, 255), width=arc_w)
    draw.arc(arc_box, start=355, end=125, fill=(234, 179, 8, 255), width=arc_w)

    # Engineering Warren Truss / Bridge Silhouette in Center
    cx, cy = size // 2, int(size * 0.52)
    span_w = int(size * 0.46)
    truss_h = int(size * 0.18)
    x0 = cx - span_w // 2
    x4 = cx + span_w // 2
    x1 = x0 + span_w // 4
    x2 = cx
    x3 = x4 - span_w // 4
    yb = cy + truss_h // 2
    yt = cy - truss_h // 2

    beam_w = max(8, size // 42)
    cyan = (56, 189, 248, 255)
    emerald = (16, 185, 129, 255)
    gold = (250, 204, 21, 255)
    white = (230, 238, 246, 255)

    # Bottom chord & top chord
    draw.line([(x0, yb), (x4, yb)], fill=cyan, width=beam_w)
    draw.line([(x1, yt), (x3, yt)], fill=cyan, width=beam_w)
    # Diagonals
    for pts in [((x0, yb), (x1, yt)), ((x1, yt), (x2, yb)), ((x2, yb), (x3, yt)), ((x3, yt), (x4, yb))]:
        draw.line(pts, fill=white, width=max(6, size // 52))

    # Structural joints (Nodes: Cleared Green, Active Cyan, Spiral Gold)
    r = max(10, size // 34)
    for (jx, jy, col) in [
        (x0, yb, emerald),
        (x1, yt, cyan),
        (x2, yb, gold),
        (x3, yt, cyan),
        (x4, yb, emerald),
    ]:
        draw.ellipse([jx - r, jy - r, jx + r, jy + r], fill=col, outline=(11, 17, 24, 255), width=max(3, size // 140))

    # Top precision crosshair tick
    top_y = arc_margin
    draw.ellipse([cx - r, top_y - r, cx + r, top_y + r], fill=gold, outline=(11, 17, 24, 255), width=max(3, size // 140))

    return img


master_any = draw_master_icon(1024, maskable=False)
master_mask = draw_master_icon(1024, maskable=True)

sizes = {
    "apple-touch-icon.png": (180, master_any),
    "apple-touch-icon-180x180.png": (180, master_any),
    "apple-touch-icon-167x167.png": (167, master_any),
    "apple-touch-icon-152x152.png": (152, master_any),
    "icon-192.png": (192, master_any),
    "icon-512.png": (512, master_any),
    "icon-maskable-512.png": (512, master_mask),
    "favicon-32.png": (32, master_any),
}

for fname, (px, src) in sizes.items():
    resized = src.resize((px, px), Image.Resampling.LANCZOS)
    # iOS Home Screen icons must be opaque RGB (no alpha channel transparency, otherwise iOS renders black artifacts)
    rgb = Image.new("RGB", (px, px), (11, 17, 24))
    rgb.paste(resized, mask=resized.split()[3])
    rgb.save(os.path.join(ICONS_DIR, fname), format="PNG", optimize=True)

# Save a compact 180x180 base64 data URI for single-file standalone embedding
buf = io.BytesIO()
icon180 = Image.open(os.path.join(ICONS_DIR, "apple-touch-icon.png"))
icon180.save(buf, format="PNG", optimize=True)
b64_icon = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
with open(os.path.join(ICONS_DIR, "icon_data_uri.txt"), "w", encoding="utf-8") as f:
    f.write(b64_icon)

manifest = {
    "id": "./index.html",
    "name": "CELE Ambush Command Center",
    "short_name": "CELE Ambush",
    "description": "126-Topic KIPPAP Civil Engineering Licensure Exam (CELE) Spiral Ambush & 3-Stage Puzzle Engine",
    "start_url": "./index.html",
    "scope": "./",
    "display": "standalone",
    "display_override": ["standalone", "minimal-ui"],
    "orientation": "any",
    "background_color": "#0b1118",
    "theme_color": "#0b1118",
    "categories": ["education", "productivity", "utilities"],
    "icons": [
        {"src": "icons/apple-touch-icon-152x152.png", "sizes": "152x152", "type": "image/png", "purpose": "any"},
        {"src": "icons/apple-touch-icon-167x167.png", "sizes": "167x167", "type": "image/png", "purpose": "any"},
        {"src": "icons/apple-touch-icon.png", "sizes": "180x180", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
    ],
    "shortcuts": [
        {
            "name": "Primary 15-Min Ambush",
            "short_name": "Primary Loop",
            "description": "Launch today's 15-minute Primary Target puzzle",
            "url": "./index.html?launch=primary",
            "icons": [{"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"}]
        },
        {
            "name": "Spiral Retention Loop",
            "short_name": "Spiral Loop",
            "description": "Launch 7-14 day Spiral Target review",
            "url": "./index.html?launch=spiral",
            "icons": [{"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"}]
        },
        {
            "name": "126-Node Matrix",
            "short_name": "Node Matrix",
            "description": "Inspect MSTE, HPGE, and PSAD topic decay grid",
            "url": "./index.html?launch=matrix",
            "icons": [{"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"}]
        }
    ]
}

with open(os.path.join(BASE_DIR, "manifest.webmanifest"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)

sw_code = """/* CELE Ambush Command Center — Offline-First iOS/iPadOS Service Worker */
const CACHE_NAME = "cele-ambush-pwa-v3";
const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./curriculum.min.js",
  "./app.js",
  "./manifest.webmanifest",
  "./cele_ambush_curriculum.json",
  "./icons/apple-touch-icon.png",
  "./icons/apple-touch-icon-167x167.png",
  "./icons/apple-touch-icon-152x152.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResp) => {
          if (networkResp && networkResp.status === 200) {
            const copy = networkResp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResp;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
"""

with open(os.path.join(BASE_DIR, "sw.js"), "w", encoding="utf-8") as f:
    f.write(sw_code)

with open(os.path.join(BASE_DIR, ".nojekyll"), "w", encoding="utf-8") as f:
    f.write("")

print(f"Generated {len(sizes)} icons (b64_len={len(b64_icon)}), manifest.webmanifest, sw.js, and .nojekyll.")
