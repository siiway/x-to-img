import { inflateRaw as pakoInflateRaw } from "pako"
import type { FontKV } from "./kv.ts"

const FONT_ZIP_URL = "https://github.com/subframe7536/maple-font/releases/download/v7.9/MapleMono-CN.zip"

const TARGET_FILES = ["MapleMono-CN-Regular.ttf", "MapleMono-CN-Bold.ttf"] as const

const KV_KEYS = {
  regular: "font:maple-mono-cn:regular",
  bold: "font:maple-mono-cn:bold",
} as const

interface FontCache {
  regular: ArrayBuffer
  bold: ArrayBuffer
}

let fontCache: FontCache | null = null
let fontDownloadPromise: Promise<FontCache> | null = null

function readU16(buf: Uint8Array, off: number) {
  return (buf[off] | (buf[off + 1] << 8)) >>> 0
}
function readU32(buf: Uint8Array, off: number) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0
}

function inflateRaw(compressed: Uint8Array) {
  if (compressed.length > 20_000_000) throw new Error(`Compressed size ${compressed.length} too large`)
  const result = pakoInflateRaw(compressed)
  if (result.length > 30_000_000) throw new Error(`Decompressed size ${result.length} too large`)
  return result
}

function findEOCD(buf: Uint8Array) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      return {
        entriesTotal: readU16(buf, i + 10),
        cdSize: readU32(buf, i + 12),
        cdOff: readU32(buf, i + 16),
      }
    }
  }
  throw new Error("EOCD not found in zip")
}

async function extractFonts(zipBuf: ArrayBuffer) {
  const buf = new Uint8Array(zipBuf)
  const { entriesTotal, cdOff } = findEOCD(buf)

  if (cdOff >= buf.length) throw new Error(`CD offset ${cdOff} beyond buffer ${buf.length}`)

  const result = new Map<string, ArrayBuffer>()

  let pos = cdOff
  for (let i = 0; i < entriesTotal; i++) {
    if (pos + 46 > buf.length) throw new Error("CD entry out of bounds")
    const sig = readU32(buf, pos)
    if (sig !== 0x02014b50) throw new Error("Invalid central directory entry")
    const method = readU16(buf, pos + 10)
    const compSize = readU32(buf, pos + 20)
    const uncompSize = readU32(buf, pos + 24)
    const nameLen = readU16(buf, pos + 28)
    const extraLen = readU16(buf, pos + 30)
    const commentLen = readU16(buf, pos + 32)
    const localOff = readU32(buf, pos + 42)
    const name = new TextDecoder().decode(buf.subarray(pos + 46, pos + 46 + nameLen))

    if (TARGET_FILES.includes(name as (typeof TARGET_FILES)[number])) {
      const lhNameLen = readU16(buf, localOff + 26)
      const lhExtraLen = readU16(buf, localOff + 28)
      const dataOff = localOff + 30 + lhNameLen + lhExtraLen

      if (dataOff + (method === 0 ? uncompSize : compSize) > buf.length) {
        throw new Error(`Font data out of bounds: offset=${dataOff} size=${method === 0 ? uncompSize : compSize} buf=${buf.length}`)
      }

      if (method === 0) {
        result.set(name, buf.slice(dataOff, dataOff + uncompSize).buffer as ArrayBuffer)
      } else if (method === 8) {
        const compressed = buf.slice(dataOff, dataOff + compSize)
        const decompressed = inflateRaw(new Uint8Array(compressed))
        result.set(name, decompressed.buffer as ArrayBuffer)
      } else {
        throw new Error(`Unsupported compression: ${method}`)
      }
    }

    pos += 46 + nameLen + extraLen + commentLen
  }

  const regular = result.get(TARGET_FILES[0])
  const bold = result.get(TARGET_FILES[1])
  if (!regular || !bold) throw new Error("Font files not found in zip")

  return { regular, bold }
}

async function downloadAndExtract(): Promise<FontCache> {
  const resp = await fetch(FONT_ZIP_URL, {
    signal: AbortSignal.timeout(120_000),
  })
  if (!resp.ok) throw new Error(`Failed to download fonts: ${resp.status}`)

  const zipBuf = await resp.arrayBuffer()
  if (zipBuf.byteLength > 200_000_000) throw new Error(`ZIP size ${zipBuf.byteLength} exceeds 200MB limit`)
  return extractFonts(zipBuf)
}

export async function loadFonts(kv?: FontKV): Promise<FontCache> {
  if (fontCache) return fontCache

  if (fontDownloadPromise) return fontDownloadPromise

  if (kv) {
    const [cachedRegular, cachedBold] = await Promise.all([
      kv.get(KV_KEYS.regular),
      kv.get(KV_KEYS.bold),
    ])
    if (cachedRegular && cachedBold) {
      fontCache = { regular: cachedRegular as ArrayBuffer, bold: cachedBold as ArrayBuffer }
      return fontCache
    }
  }

  fontDownloadPromise = downloadAndExtract()

  try {
    const fonts = await fontDownloadPromise

    if (kv) {
      await Promise.all([
        kv.put(KV_KEYS.regular, fonts.regular),
        kv.put(KV_KEYS.bold, fonts.bold),
      ])
    }

    fontCache = fonts
    return fonts
  } finally {
    fontDownloadPromise = null
  }
}

export function getSatoriFonts(fonts: FontCache) {
  return [
    {
      name: "Maple Mono CN",
      data: fonts.regular,
      weight: 400 as const,
      style: "normal" as const,
    },
    {
      name: "Maple Mono CN",
      data: fonts.bold,
      weight: 700 as const,
      style: "normal" as const,
    },
  ]
}
