import { crc32, deflateSync } from 'node:zlib'

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)])
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)])
export const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32, 3)])
export const TEXT = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

export const IMAGES = [
  { type: 'image/png', bytes: PNG },
  { type: 'image/jpeg', bytes: JPEG },
  { type: 'image/webp', bytes: WEBP },
] as const

type Rect = [x: number, y: number, w: number, h: number, rgb: [number, number, number]]

const chunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])))
  return Buffer.concat([head, data, crc])
}

export const drawnPng = (width: number, height: number, rects: Rect[]): Buffer => {
  const pixels = Buffer.alloc((width * 3 + 1) * height, 255)
  for (let y = 0; y < height; y++) pixels[y * (width * 3 + 1)] = 0
  for (const [x, y, w, h, rgb] of rects) {
    for (let row = y; row < Math.min(y + h, height); row++) {
      for (let col = x; col < Math.min(x + w, width); col++) pixels.set(rgb, row * (width * 3 + 1) + 1 + col * 3)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    PNG.subarray(0, 8),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
