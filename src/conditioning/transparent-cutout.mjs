import sharp from 'sharp';

export async function removeBorderConnectedWhiteToAlpha(input, { minimumChannel = 245, maximumChroma = 10 } = {}) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const qualifies = (index) => {
    const offset = index * channels;
    const values = [data[offset], data[offset + 1], data[offset + 2]];
    return Math.min(...values) >= minimumChannel && Math.max(...values) - Math.min(...values) <= maximumChroma;
  };
  const enqueue = (index) => {
    if (visited[index] || !qualifies(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  let transparentPixels = 0;
  for (let index = 0; index < visited.length; index += 1) {
    if (!visited[index]) continue;
    data[index * channels + 3] = 0;
    transparentPixels += 1;
  }
  return {
    image: await sharp(data, { raw: info }).png().toBuffer(),
    stats: { width, height, transparent_pixels: transparentPixels, minimum_channel: minimumChannel, maximum_chroma: maximumChroma, connectivity: 4 },
  };
}
