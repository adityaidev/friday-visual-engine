"""Generate a clean, minimal 1200x630 OG image for FRIDAY.
Editorial composition: huge wordmark, thin rule, subtitle, bottom meta row.
No decorative flourishes, no AI-style gradients, no stock imagery.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

W, H = 1200, 630
BG = (3, 7, 18)            # near-black slate
TEXT = (240, 245, 252)     # off-white
MUTED = (148, 163, 184)    # slate-400
ACCENT = (34, 211, 238)    # cyan-400
ACCENT_DIM = (34, 211, 238, 40)

FONT_BLACK = "C:/Windows/Fonts/seguibl.ttf"   # Segoe UI Black
FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"   # Segoe UI Bold
FONT_MONO = "C:/Windows/Fonts/consolab.ttf"   # Consolas Bold

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img, "RGBA")

# Subtle dot grid in background (barely visible)
for y in range(0, H, 40):
    for x in range(0, W, 40):
        d.point((x, y), fill=(30, 41, 59))

# Hexagon mark in top-left corner
cx, cy, r = 82, 88, 26
import math
hex_pts = [(cx + r * math.cos(math.radians(60 * i - 30)),
            cy + r * math.sin(math.radians(60 * i - 30))) for i in range(6)]
d.polygon(hex_pts, outline=ACCENT, width=2)
d.text((cx - 7, cy - 12), "F", font=ImageFont.truetype(FONT_BLACK, 24), fill=TEXT)

# Right-aligned small system label
label_font = ImageFont.truetype(FONT_MONO, 14)
d.text((W - 82, 84), "NEURAL ENGINE v1.0", font=label_font, fill=MUTED, anchor="rm")

# Main wordmark — big letter-spaced FRIDAY
title_font = ImageFont.truetype(FONT_BLACK, 180)
title = "FRIDAY"
# Measure and draw with custom letter-spacing
letter_spacing = 12
letters = list(title)
total_w = 0
bboxes = [title_font.getbbox(c) for c in letters]
widths = [b[2] - b[0] for b in bboxes]
total_w = sum(widths) + letter_spacing * (len(letters) - 1)
x = (W - total_w) // 2
baseline_y = 265
for i, c in enumerate(letters):
    d.text((x, baseline_y), c, font=title_font, fill=TEXT)
    x += widths[i] + letter_spacing

# Thin cyan rule under wordmark
rule_w = 260
rule_x = (W - rule_w) // 2
d.rectangle((rule_x, 460, rule_x + rule_w, 463), fill=ACCENT)

# Subtitle
sub_font = ImageFont.truetype(FONT_BOLD, 32)
sub = "Immersive Engineering Visual Intelligence"
sbox = d.textbbox((0, 0), sub, font=sub_font)
sw = sbox[2] - sbox[0]
d.text(((W - sw) // 2, 485), sub, font=sub_font, fill=MUTED)

# Footer meta row
meta_font = ImageFont.truetype(FONT_MONO, 16)
left = "friday.adityaai.dev"
right = "GEMINI 3.1 PRO · THREE.JS · VERCEL"
d.text((80, H - 56), left, font=meta_font, fill=TEXT)
d.text((W - 80, H - 56), right, font=meta_font, fill=MUTED, anchor="rm")

# Top + bottom thin accent lines for editorial feel
d.rectangle((0, 0, W, 2), fill=ACCENT)
d.rectangle((0, H - 2, W, H), fill=(30, 41, 59))

out = Path(__file__).resolve().parent.parent / "public" / "og-image.png"
out.parent.mkdir(parents=True, exist_ok=True)
img.save(out, "PNG", optimize=True)
print(f"Wrote {out}")
