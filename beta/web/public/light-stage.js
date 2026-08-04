/**
 * Light Stage is a presentation-only web component.
 * It never edits, exports, or replaces the supplied master image.
 */

export const BLACK_GOLD_LIGHT_STAGE = Object.freeze({
  id: 'black-gold',
  rimColor: '#e6ac48',
  floorColor: '#060707',
  shadowOpacity: 0.46,
});

function isBorderWhite(data, offset, minimumChannel, maximumChroma) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return Math.min(red, green, blue) >= minimumChannel
    && Math.max(red, green, blue) - Math.min(red, green, blue) <= maximumChroma;
}

/**
 * Removes only near-white pixels connected to the outer edge. A white garment
 * detail enclosed by the subject remains opaque. This mirrors the server-side
 * conditioning rule but runs only against an in-memory presentation derivative.
 */
export function createWhiteBorderMatte(rgba, width, height, {
  minimumChannel = 245,
  maximumChroma = 10,
} = {}) {
  if (!(rgba instanceof Uint8ClampedArray)) throw new TypeError('rgba must be Uint8ClampedArray');
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || rgba.length !== width * height * 4) {
    throw new RangeError('RGBA dimensions do not match');
  }
  const result = new Uint8ClampedArray(rgba);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const enqueue = (index) => {
    if (visited[index] || !isBorderWhite(rgba, index * 4, minimumChannel, maximumChroma)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { enqueue(y * width); enqueue((y * width) + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index]) result[(index * 4) + 3] = 0;
  }
  return result;
}

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('LIGHT_STAGE_IMAGE_LOAD_FAILED'));
    image.src = url;
  });
}

function prepareMatte(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('LIGHT_STAGE_CANVAS_UNAVAILABLE');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  pixels.data.set(createWhiteBorderMatte(pixels.data, canvas.width, canvas.height));
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Mount the reusable visual-only stage into any empty HTML element. */
export async function mountLightStage(root, { imageUrl, alt = '', recipe = BLACK_GOLD_LIGHT_STAGE } = {}) {
  if (!root || !(root instanceof Element)) throw new TypeError('root must be an Element');
  if (!imageUrl) throw new TypeError('imageUrl is required');
  const image = await imageFromUrl(imageUrl);
  const matteUrl = prepareMatte(image);
  root.classList.add('light-stage');
  root.dataset.lightStage = recipe.id;
  root.style.setProperty('--light-stage-rim', recipe.rimColor);
  root.style.setProperty('--light-stage-floor', recipe.floorColor);
  root.style.setProperty('--light-stage-shadow-opacity', String(recipe.shadowOpacity));
  root.replaceChildren();
  for (const role of ['floor', 'shadow', 'rim', 'subject']) {
    const layer = document.createElement(role === 'subject' ? 'img' : 'span');
    layer.className = `light-stage__${role}`;
    if (role === 'rim' || role === 'subject') layer.style.backgroundImage = `url("${matteUrl}")`;
    if (role === 'subject') { layer.src = matteUrl; layer.alt = alt; layer.style.backgroundImage = ''; }
    root.append(layer);
  }
  return Object.freeze({ imageUrl, matteUrl, recipe: recipe.id, presentationOnly: true });
}
