import sys
import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables._c_m_a_p import cmap_format_13, cmap_format_12, cmap_format_4
from fontTools.ttLib import newTable

def draw_block(pen, width, height, y_offset=0):
    pen.moveTo((0, y_offset))
    pen.lineTo((0, y_offset + height))
    pen.lineTo((width, y_offset + height))
    pen.lineTo((width, y_offset))
    pen.closePath()

def create_font(output_path, use_format_13=True):
    UPEM = 1000
    ASCENT = 900
    DESCENT = -100
    W_SPACE = 300
    W_LATIN = 550
    W_CJK = 1000
    BLOCK_HEIGHT = 1000
    BLOCK_Y = -100

    fb = FontBuilder(UPEM, isTTF=True)
    
    glyph_order = ['.notdef', 'space', 'block_latin', 'block_cjk']
    glyphs = {}
    
    # .notdef
    pen = TTGlyphPen(None)
    glyphs['.notdef'] = pen.glyph()
    
    # space
    pen = TTGlyphPen(None)
    glyphs['space'] = pen.glyph()
    
    # block_latin
    pen = TTGlyphPen(None)
    draw_block(pen, W_LATIN, BLOCK_HEIGHT, BLOCK_Y)
    glyphs['block_latin'] = pen.glyph()
    
    # block_cjk
    pen = TTGlyphPen(None)
    draw_block(pen, W_CJK, BLOCK_HEIGHT, BLOCK_Y)
    glyphs['block_cjk'] = pen.glyph()
    
    fb.setupGlyphOrder(glyph_order)
    fb.setupGlyf(glyphs)
    
    metrics = {
        '.notdef': (W_LATIN, 0),
        'space': (W_SPACE, 0),
        'block_latin': (W_LATIN, 0),
        'block_cjk': (W_CJK, 0)
    }
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    
    name_strings = {
        'familyName': 'Skeleton Tofu',
        'styleName': 'Regular',
        'uniqueFontIdentifier': 'Skeleton Tofu Regular',
        'fullName': 'Skeleton Tofu Regular',
        'version': 'Version 1.0',
        'psName': 'SkeletonTofu-Regular',
    }
    fb.setupNameTable(name_strings)
    cmap_dict = {}
    
    # Default to CJK block for EVERYTHING
    for cp in range(0x0000, 0x10FFFF + 1):
        cmap_dict[cp] = 'block_cjk'
        
    for cp in range(0x0000, 0x0020 + 1):
        cmap_dict[cp] = 'space'
        
    # ASCII, Extended Latin, Greek, Cyrillic
    for cp in range(0x0021, 0x052F + 1):
        cmap_dict[cp] = 'block_latin'
        
    # Punctuation
    for cp in range(0x2000, 0x206F + 1):
        cmap_dict[cp] = 'block_latin'
        
    # Halfwidth and Fullwidth Forms (Halfwidth -> Latin)
    for cp in range(0xFF61, 0xFFDC + 1):
        cmap_dict[cp] = 'block_latin'

    cmap_table = newTable('cmap')
    cmap_table.tableVersion = 0
    cmap_table.tables = []

    if use_format_13:
        # format 13
        subtable = cmap_format_13(13)
        subtable.platformID = 3
        subtable.platEncID = 10
        subtable.language = 0
        subtable.cmap = cmap_dict
        cmap_table.tables.append(subtable)
        
    else:
        # If not format 13, let's use setupCharacterMap to build 4 & 12 automatically, 
        # but only for a subset of characters to save size, since mapping 1M chars in format 4/12 takes megabytes.
        subset_cmap = {}
        for cp in range(0x0000, 0x052F + 1):
            subset_cmap[cp] = cmap_dict[cp]
        for cp in range(0x4E00, 0x9FFF + 1): # Just CJK unified
            subset_cmap[cp] = cmap_dict[cp]
        fb.setupCharacterMap(subset_cmap)
        
    if use_format_13:
        fb.font['cmap'] = cmap_table

    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, usWinAscent=ASCENT, usWinDescent=abs(DESCENT))
    fb.setupPost()

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    fb.save(output_path)
    size = os.path.getsize(output_path)
    print(f"Font saved to {output_path} - Size: {size} bytes")

if __name__ == '__main__':
    create_font(r'E:\workspaces\codejoo\apps\skeletonizer\demo\.tmp-tofu\tofu-fmt13.ttf', True)
    create_font(r'E:\workspaces\codejoo\apps\skeletonizer\bench\agents\a8-tofu-font\tofu-fmt13.ttf', True)
