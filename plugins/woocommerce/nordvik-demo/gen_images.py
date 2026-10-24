"""Typographic product images for the Nordvik demo (no product photography, on purpose)."""
import json, os, textwrap
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PALETTE = {  # category: (background, foreground)
    "Bags": ("#1E3A2F", "#F5F6F2"), "Footwear": ("#2F3A35", "#C8D2B4"), "Apparel": ("#C8D2B4", "#1E3A2F"),
    "Outdoor": ("#6B7A4B", "#F5F6F2"), "Coffee": ("#5A4636", "#F2E9DC"), "Home": ("#D8D2C3", "#3A3328"),
    "Audio": ("#3D4A3F", "#F5F6F2"), "Photo": ("#262B31", "#F2C230"), "Stationery": ("#E2E5DC", "#1E3A2F"),
    "Books": ("#B9C4C9", "#1E2A30"), "Vinyl": ("#2A2433", "#E9D8F5"), "Video games": ("#14161C", "#7CF2C6"),
    "Board games": ("#8C3B2E", "#F7E7D4"),
}
BOLD = ("/System/Library/Fonts/Avenir Next.ttc", 8)        # Heavy
REG = ("/System/Library/Fonts/Avenir Next.ttc", 5)         # Medium
font = lambda spec, size: ImageFont.truetype(spec[0], size, index=spec[1])
S = 900

def fit(draw, text, spec, max_w, start):
    """Largest size where text wraps between words (never inside one) into at most 3 lines."""
    words = text.split()
    for size in range(start, 23, -4):
        f = font(spec, size)
        if any(draw.textlength(w, font=f) > max_w for w in words):
            continue
        lines, cur = [], ""
        for w in words:
            trial = f"{cur} {w}".strip()
            if draw.textlength(trial, font=f) <= max_w:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
        if len(lines) <= 3:
            return f, lines
    return font(spec, 24), [text]

products = json.load(open(os.path.join(HERE, "seed/products.json")))
for p in products:
    bg, fg = PALETTE.get(p["category"], ("#1E3A2F", "#F5F6F2"))
    im = Image.new("RGB", (S, S), bg)
    d = ImageDraw.Draw(im)
    d.rectangle([72, 72, 72 + 120, 72 + 22], fill="#F2C230" if bg != "#262B31" else fg)
    d.text((72, 120), p["category"], font=font(REG, 34), fill=fg)
    # For cultural goods the work is the headline (Bon Iver, Alan Wake 2), not the label.
    title, _, author = p["name"].partition(" — ")
    if p["category"] == "Vinyl":
        headline, sub = author.replace(" (LP)", ""), title
    elif p["category"] == "Books":
        headline, sub = title, author or p["brand"]
    elif p["category"] in ("Video games", "Board games"):
        headline, sub = title.split(" (")[0], p["brand"]
    else:
        headline, sub = p["brand"], title
    f, lines = fit(d, headline, BOLD, S - 144, 150)
    lh = f.size * 1.02
    y = S - 72 - 110 - lh * len(lines)
    for l in lines:
        d.text((66, y), l, font=f, fill=fg)
        y += lh
    d.text((72, S - 72 - 70), textwrap.shorten(sub, 40, placeholder="…"), font=font(REG, 38), fill=fg)
    im.save(os.path.join(HERE, f"seed/images/{p['sku']}.jpg"), quality=82, optimize=True)
print(len(products), "images")
