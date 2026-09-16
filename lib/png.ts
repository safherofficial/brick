// Encoder PNG minimale, senza dipendenze esterne — nello stesso spirito del
// resto del progetto (vedi il writer .vox e lo zip STORE per l'export
// .obj): niente libreria di compressione, i blocchi DEFLATE sono "stored"
// (non compressi). Per l'uso previsto qui — texture-atlas di poche decine
// o centinaia di pixel — un vero DEFLATE non porterebbe benefici reali,
// solo complessità.

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function adler32(bytes: Uint8Array): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

// zlib stream con blocchi DEFLATE "stored" (BTYPE=00): header 2 byte,
// N blocchi di [1 byte flag][LEN 2 byte LE][~LEN 2 byte LE][dati], footer
// adler32 4 byte big-endian. Max 65535 byte per blocco: per dati più grandi
// si incatenano più blocchi, solo l'ultimo con BFINAL=1.
function deflateStored(data: Uint8Array): Uint8Array {
  const MAX_BLOCK = 65535;
  const blocks: Uint8Array[] = [];
  let offset = 0;
  do {
    const len = Math.min(MAX_BLOCK, data.length - offset);
    const isLast = offset + len >= data.length;
    const block = new Uint8Array(5 + len);
    block[0] = isLast ? 1 : 0;
    const view = new DataView(block.buffer);
    view.setUint16(1, len, true);
    view.setUint16(3, len ^ 0xffff, true);
    block.set(data.subarray(offset, offset + len), 5);
    blocks.push(block);
    offset += len;
  } while (offset < data.length);

  const bodyLen = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(2 + bodyLen + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let p = 2;
  for (const b of blocks) {
    out.set(b, p);
    p += b.length;
  }
  new DataView(out.buffer).setUint32(2 + bodyLen, adler32(data), false);
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

// Codifica un'immagine RGBA (4 byte/pixel, righe dall'alto verso il basso,
// come nel buffer passato) in un PNG valido a 8 bit/canale, color type 6.
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (width <= 0 || height <= 0) throw new Error("encodePng: dimensioni non valide");
  if (rgba.length !== width * height * 4) {
    throw new Error("encodePng: il buffer RGBA non corrisponde a width*height*4");
  }

  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride);
    raw[rowStart] = 0; // byte di filtro "None" a inizio riga
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = pngChunk("IHDR", ihdr);
  const idatChunk = pngChunk("IDAT", deflateStored(raw));
  const iendChunk = pngChunk("IEND", new Uint8Array(0));

  const out = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let p = 0;
  out.set(signature, p);
  p += signature.length;
  out.set(ihdrChunk, p);
  p += ihdrChunk.length;
  out.set(idatChunk, p);
  p += idatChunk.length;
  out.set(iendChunk, p);
  return out;
}
