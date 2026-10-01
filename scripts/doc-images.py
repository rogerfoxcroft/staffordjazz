#!/usr/bin/env python3
"""Extract the photos embedded in a Word 97-2003 .doc (the client's monthly "Pictures" file).

Usage: python3 scripts/doc-images.py "Pictures - September 26.doc" OUT_DIR
Needs olefile (pip install olefile, e.g. in a throwaway venv).

Writes photo1.jpg, photo2.jpg ... in stream order, which is NOT the caption order in the
document - match each photo to its concert by looking at it. EXIF is stripped from the
output: Word keeps the camera's original Orientation tag after baking the rotation into the
pixels, so leaving it in makes browsers show the photo upside down or sideways.
"""
import re
import struct
import subprocess
import sys
from pathlib import Path

import olefile

# Office Drawing BLIP records: JPEG (two variants), PNG.
BLIP_TYPES = {0xF01D: 'jpg', 0xF02A: 'jpg', 0xF01E: 'png'}
SIGNATURES = rb'\xff\xd8\xff|\x89PNG\r\n\x1a\n'

src, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
ole = olefile.OleFileIO(src)
n = 0
for stream in ('WordDocument', 'Data'):
    if not ole.exists(stream):
        continue
    data = ole.openstream(stream).read()
    for m in re.finditer(SIGNATURES, data):
        start = m.start()
        # The record header sits before a 1-byte tag and one or two 16-byte UIDs.
        for header in (start - 25, start - 41):
            if header < 0:
                continue
            _, rec_type, length = struct.unpack('<HHI', data[header:header + 8])
            if rec_type in BLIP_TYPES:
                n += 1
                path = out / f'photo{n}.{BLIP_TYPES[rec_type]}'
                path.write_bytes(data[start:header + 8 + length])
                subprocess.run(['magick', 'mogrify', '-strip', str(path)], check=True)
                print(path)
                break
print(f'{n} images')
