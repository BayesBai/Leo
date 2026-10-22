"""Optional build-time provenance tool; committed static fonts require no Python at runtime.
Usage: python scripts/prepare-font.py path/to/NotoSansSC-variable.ttf
Requires fonttools==4.60.1. Obtain the source and OFL from THIRD_PARTY_NOTICES.md.
"""
from pathlib import Path
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source = Path(sys.argv[1])
target = Path(__file__).resolve().parent.parent / 'server' / 'render' / 'fonts'
for weight, name in [(400, 'NotoSansSC.ttf'), (700, 'NotoSansSC-Bold.ttf')]:
    font = TTFont(source)
    instantiateVariableFont(font, {'wght': weight}, inplace=True)
    font.save(target / name)
    print(f'Saved {name} (weight {weight})')
