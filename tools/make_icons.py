"""Draws the app icons (a white dumbbell on a blue gradient) as PNG files.
Pure Python, no extra libraries. Run:  python tools/make_icons.py"""
import struct, zlib, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')

def png(path, size, pixels):
    raw = b''.join(b'\x00' + bytes(pixels[y * size * 3:(y + 1) * size * 3]) for y in range(size))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

def rrect(x, y, cx, cy, w, h, r):
    # inside a rounded rectangle centred on (cx, cy)?
    dx = max(abs(x - cx) - (w / 2 - r), 0)
    dy = max(abs(y - cy) - (h / 2 - r), 0)
    return dx * dx + dy * dy <= r * r

def shape(u, v, scale):
    # u, v in 0..1 ; returns True where the dumbbell is
    s = scale
    c = 0.5
    parts = [
        (c, c, 0.46 * s, 0.075 * s, 0.03 * s),                # bar
        (c - 0.20 * s, c, 0.085 * s, 0.42 * s, 0.04 * s),      # inner plates
        (c + 0.20 * s, c, 0.085 * s, 0.42 * s, 0.04 * s),
        (c - 0.305 * s, c, 0.07 * s, 0.28 * s, 0.035 * s),     # outer plates
        (c + 0.305 * s, c, 0.07 * s, 0.28 * s, 0.035 * s),
    ]
    return any(rrect(u, v, *p) for p in parts)

def draw(size, scale):
    top, bot = (0x3d, 0x8f, 0xf0), (0x1b, 0x4f, 0xa8)
    ss = 3
    px = []
    for y in range(size):
        for x in range(size):
            hits = 0
            for sy in range(ss):
                for sx in range(ss):
                    if shape((x + (sx + .5) / ss) / size, (y + (sy + .5) / ss) / size, scale):
                        hits += 1
            a = hits / (ss * ss)
            t = (x + y) / (2 * size)
            bg = [round(top[i] + (bot[i] - top[i]) * t) for i in range(3)]
            px += [round(bg[i] + (255 - bg[i]) * a) for i in range(3)]
    return px

for name, size, scale in [('icon-180.png', 180, 1.0), ('icon-192.png', 192, 1.0),
                          ('icon-512.png', 512, 1.0), ('icon-maskable-512.png', 512, 0.78)]:
    png(os.path.join(OUT, name), size, draw(size, scale))
    print('wrote', name)
