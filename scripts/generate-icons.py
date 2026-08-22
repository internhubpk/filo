#!/usr/bin/env python3
"""Generate PWA icons for Filo"""

import os
import struct
import zlib

def create_png(width: int, height: int, color: tuple) -> bytes:
    """Create a minimal PNG file with solid color"""
    
    def chunk(chunk_type: str, data: bytes) -> bytes:
        c = chunk_type.encode('ascii') + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc
    
    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    ihdr = chunk('IHDR', ihdr_data)
    
    # IDAT chunk - image data
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter byte (none)
        for x in range(width):
            # Create a gradient-like effect with the brand color
            r = color[0]
            g = color[1]
            b = color[2]
            raw_data += struct.pack('BBB', r, g, b)
    
    compressed = zlib.compress(raw_data)
    idat = chunk('IDAT', compressed)
    
    # IEND chunk
    iend = chunk('IEND', b'')
    
    return signature + ihdr + idat + iend


def main():
    # Filo brand colors - blue (#2563eb)
    primary_color = (37, 99, 235)  # RGB for #2563eb
    
    sizes = [72, 96, 128, 144, 152, 192, 384, 512]
    
    output_dir = '/home/z/my-project/public/icons'
    os.makedirs(output_dir, exist_ok=True)
    
    for size in sizes:
        filename = f'icon-{size}x{size}.png'
        filepath = os.path.join(output_dir, filename)
        
        png_data = create_png(size, size, primary_color)
        
        with open(filepath, 'wb') as f:
            f.write(png_data)
        
        print(f'✅ Created {filename}')


if __name__ == '__main__':
    main()
