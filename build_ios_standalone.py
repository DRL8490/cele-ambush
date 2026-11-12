#!/usr/bin/env python3
"""Bundle index.html + styles.css + curriculum.min.js + app.js + base64 Apple Touch Icon into a single zero-server iOS/iPadOS HTML app."""
import os
import re

BASE = "/home/antigravity/cele-ambush"

html = open(os.path.join(BASE, "index.html"), encoding="utf-8").read()
css = open(os.path.join(BASE, "styles.css"), encoding="utf-8").read()
curr = open(os.path.join(BASE, "curriculum.min.js"), encoding="utf-8").read()
app = open(os.path.join(BASE, "app.js"), encoding="utf-8").read()
b64_icon = open(os.path.join(BASE, "icons", "icon_data_uri.txt"), encoding="utf-8").read().strip()

# Replace external icon/manifest/css links in <head> with embedded data-URI icons + inline <style>
head_repl = f"""  <link rel="icon" type="image/png" href="{b64_icon}" />
  <link rel="apple-touch-icon" href="{b64_icon}" />
  <link rel="apple-touch-icon" sizes="180x180" href="{b64_icon}" />
  <link rel="apple-touch-icon" sizes="167x167" href="{b64_icon}" />
  <link rel="apple-touch-icon" sizes="152x152" href="{b64_icon}" />
  <style>
{css}
  </style>"""

out_html = re.sub(
    r'\s*<link rel="manifest"[\s\S]*?<link rel="stylesheet" href="styles\.css" />',
    lambda _m: "\n" + head_repl,
    html,
    count=1,
)

scripts_repl = f"""  <script>
{curr}
  </script>
  <script>
{app}
  </script>"""

out_html = re.sub(
    r'\s*<script src="curriculum\.min\.js"></script>\s*<script src="app\.js"></script>',
    lambda _m: "\n" + scripts_repl,
    out_html,
    count=1,
)

out_path = os.path.join(BASE, "CELE_Ambush_iOS_Standalone.html")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(out_html)

print(f"Built {out_path} ({os.path.getsize(out_path)} bytes)")
