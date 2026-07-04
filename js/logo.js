// logo.js — load an image, trim to its opaque bounding box, and measure the
// alpha footprint so transparent regions (e.g. the corners of a circular PNG)
// are treated as empty space rather than reserved area.

const ALPHA_THRESHOLD = 12; // 0–255; below this a pixel counts as transparent

let uid = 0;

/**
 * Load a File into a trimmed logo descriptor.
 * Returns: { id, name, canvas, w, h, footprintRadius, opaqueFrac, scale }
 *  - canvas: offscreen canvas cropped to the opaque bounding box
 *  - w,h: cropped dimensions (source px)
 *  - footprintRadius: radius (source px) of a circle with the same area as the
 *    opaque pixels — the "visual mass" used for even spacing
 *  - scale: user tier scale in percent (defaults to 100)
 */
export async function loadLogo(file) {
  const img = await fileToImage(file);
  const { canvas, w, h, opaquePixels } = trimToOpaque(img);
  const footprintRadius = Math.sqrt(Math.max(opaquePixels, 1) / Math.PI);
  return {
    id: `logo-${uid++}`,
    name: file.name.replace(/\.[^.]+$/, ''),
    canvas,
    w,
    h,
    footprintRadius,
    opaqueFrac: opaquePixels / (w * h || 1),
    scale: 100,
  };
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not load ${file.name}`));
    };
    img.src = url;
  });
}

// Draw the image, scan alpha, crop to the opaque bbox, and count opaque pixels.
function trimToOpaque(img) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const src = document.createElement('canvas');
  src.width = iw;
  src.height = ih;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, iw, ih);

  let minX = iw, minY = ih, maxX = -1, maxY = -1, opaque = 0;
  let data;
  try {
    data = sctx.getImageData(0, 0, iw, ih).data;
  } catch (e) {
    // Tainted canvas (rare for local files) — fall back to full image.
    return { canvas: src, w: iw, h: ih, opaquePixels: iw * ih };
  }

  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const a = data[(y * iw + x) * 4 + 3];
      if (a > ALPHA_THRESHOLD) {
        opaque++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Fully transparent (shouldn't happen) — keep original.
  if (maxX < 0) return { canvas: src, w: iw, h: ih, opaquePixels: iw * ih };

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(src, minX, minY, w, h, 0, 0, w, h);
  return { canvas: out, w, h, opaquePixels: opaque };
}
