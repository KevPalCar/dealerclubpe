// Convierte una grabación WebM/Opus (lo que graba Chrome/Edge) a OGG/Opus,
// el formato de nota de voz que acepta WhatsApp. No recodifica: saca los
// paquetes Opus del WebM y los vuelve a empaquetar en páginas Ogg.

const ID = {
  SEGMENT: 0x18538067, CLUSTER: 0x1f43b675, TRACKS: 0x1654ae6b, TRACK_ENTRY: 0xae,
  AUDIO: 0xe1, BLOCK_GROUP: 0xa0, BLOCK: 0xa1, SIMPLE_BLOCK: 0xa3, CODEC_PRIVATE: 0x63a2,
  CHANNELS: 0x9f,
};
const MASTERS = new Set([ID.SEGMENT, ID.CLUSTER, ID.TRACKS, ID.TRACK_ENTRY, ID.AUDIO, ID.BLOCK_GROUP]);

// Entero de longitud variable de EBML. keepMarker=true para los IDs.
function vint(b, pos, keepMarker) {
  const first = b[pos];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8) throw new Error("WebM inválido");
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

function readUint(b, pos, size) {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + b[pos + i];
  return v;
}

function parseWebm(b) {
  const packets = [];
  let codecPrivate = null, channels = 1;
  let pos = 0;
  while (pos < b.length) {
    const id = vint(b, pos, true);
    const size = vint(b, pos + id.len, false);
    const start = pos + id.len + size.len;
    if (MASTERS.has(id.value)) { pos = start; continue; } // entrar al contenedor
    if (size.unknown) break;
    const end = Math.min(start + size.value, b.length);
    if (id.value === ID.CODEC_PRIVATE) codecPrivate = b.slice(start, end);
    else if (id.value === ID.CHANNELS) channels = readUint(b, start, end - start);
    else if (id.value === ID.SIMPLE_BLOCK || id.value === ID.BLOCK) {
      const track = vint(b, start, false);
      const flags = b[start + track.len + 2];
      if (flags & 0x06) throw new Error("WebM con lacing no soportado");
      packets.push(b.slice(start + track.len + 3, end));
    }
    pos = end;
  }
  return { packets, codecPrivate, channels };
}

// Muestras (a 48 kHz) de un paquete Opus, según su byte TOC (RFC 6716 §3.1).
function opusSamples(p) {
  const config = p[0] >> 3;
  let ms;
  if (config < 12) ms = [10, 20, 40, 60][config % 4];
  else if (config < 16) ms = config % 2 ? 20 : 10;
  else ms = [2.5, 5, 10, 20][config % 4];
  const code = p[0] & 3;
  const frames = code === 0 ? 1 : code === 3 ? (p[1] & 0x3f) : 2;
  return Math.round(ms * 48) * frames;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function oggPage(packets, granule, serial, seq, headerType) {
  const lacing = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) { lacing.push(255); n -= 255; }
    lacing.push(n);
  }
  const dataLen = packets.reduce((s, p) => s + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + dataLen);
  const dv = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53]); // "OggS"
  page[5] = headerType;
  dv.setUint32(6, granule % 0x100000000, true);
  dv.setUint32(10, Math.floor(granule / 0x100000000), true);
  dv.setUint32(14, serial, true);
  dv.setUint32(18, seq, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let off = 27 + lacing.length;
  for (const p of packets) { page.set(p, off); off += p.length; }
  let crc = 0;
  for (let i = 0; i < page.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ page[i]) & 0xff]) >>> 0;
  dv.setUint32(22, crc, true);
  return page;
}

function opusHead(channels) {
  const h = new Uint8Array(19);
  const dv = new DataView(h.buffer);
  h.set(new TextEncoder().encode("OpusHead"));
  h[8] = 1; h[9] = channels;
  dv.setUint16(10, 312, true);   // pre-skip típico del codificador
  dv.setUint32(12, 48000, true);
  return h;
}

function opusTags() {
  const vendor = new TextEncoder().encode("DealerClub panel");
  const t = new Uint8Array(8 + 4 + vendor.length + 4);
  const dv = new DataView(t.buffer);
  t.set(new TextEncoder().encode("OpusTags"));
  dv.setUint32(8, vendor.length, true);
  t.set(vendor, 12);
  return t; // 0 comentarios (los últimos 4 bytes ya son 0)
}

export function webmToOgg(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { packets, codecPrivate, channels } = parseWebm(b);
  if (!packets.length) throw new Error("La grabación está vacía");
  const head = codecPrivate && codecPrivate.length >= 19 ? codecPrivate : opusHead(channels);
  const serial = (Math.random() * 0xffffffff) >>> 0;
  const pages = [oggPage([head], 0, serial, 0, 0x02), oggPage([opusTags()], 0, serial, 1, 0)];
  let seq = 2, granule = 0, group = [], segs = 0;
  const flush = (last) => {
    pages.push(oggPage(group, granule, serial, seq++, last ? 0x04 : 0));
    group = []; segs = 0;
  };
  packets.forEach((p, i) => {
    const n = Math.floor(p.length / 255) + 1;
    if (segs + n > 255) flush(false);
    group.push(p); segs += n;
    granule += opusSamples(p);
    if (i === packets.length - 1) flush(true);
  });
  const out = new Uint8Array(pages.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of pages) { out.set(p, off); off += p.length; }
  return out;
}
