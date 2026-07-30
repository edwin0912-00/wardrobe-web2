import sharp from 'sharp';

export async function removeBorderConnectedWhiteToAlpha(input, {
  minimumChannel = 245,
  maximumChroma = 10,
  removeDetachedLowContrastResidue = false,
  residueMinimumChannel = 236,
  residueMaximumChroma = 16,
  minimumStrongPixelRatio = 0.01,
} = {}) {
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
  let removedResiduePixels = 0;
  let removedResidueComponents = 0;
  if (removeDetachedLowContrastResidue) {
    const labels = new Int32Array(width * height);
    const components = [];
    const isForeground = (index) => data[index * channels + 3] > 0;
    const isStrongForeground = (index) => {
      const offset = index * channels;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      return Math.min(red, green, blue) < residueMinimumChannel
        || Math.max(red, green, blue) - Math.min(red, green, blue) > residueMaximumChroma;
    };
    const enqueueForeground = (index, label) => {
      if (labels[index] !== 0 || !isForeground(index)) return;
      labels[index] = label;
      queue[tail++] = index;
    };
    for (let start = 0; start < labels.length; start += 1) {
      if (labels[start] !== 0 || !isForeground(start)) continue;
      const label = components.length + 1;
      head = 0;
      tail = 0;
      enqueueForeground(start, label);
      let pixels = 0;
      let strongPixels = 0;
      while (head < tail) {
        const index = queue[head++];
        pixels += 1;
        if (isStrongForeground(index)) strongPixels += 1;
        const x = index % width;
        const y = Math.floor(index / width);
        for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
          for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
            if (xOffset === 0 && yOffset === 0) continue;
            const nextX = x + xOffset;
            const nextY = y + yOffset;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
            enqueueForeground(nextY * width + nextX, label);
          }
        }
      }
      components.push({ label, pixels, strongPixels });
    }
    const hasStrongForeground = components.some(({ strongPixels }) => strongPixels > 0);
    const residueLabels = new Set(components
      .filter(({ pixels, strongPixels }) => (
        hasStrongForeground
        && strongPixels / pixels < minimumStrongPixelRatio
      ))
      .map(({ label }) => label));
    if (residueLabels.size > 0) {
      removedResidueComponents = residueLabels.size;
      for (let index = 0; index < labels.length; index += 1) {
        if (!residueLabels.has(labels[index])) continue;
        data[index * channels + 3] = 0;
        removedResiduePixels += 1;
      }
      transparentPixels += removedResiduePixels;
    }
  }
  return {
    image: await sharp(data, { raw: info }).png().toBuffer(),
    stats: {
      width,
      height,
      transparent_pixels: transparentPixels,
      minimum_channel: minimumChannel,
      maximum_chroma: maximumChroma,
      connectivity: 4,
      detached_residue_cleanup: removeDetachedLowContrastResidue,
      removed_residue_pixels: removedResiduePixels,
      removed_residue_components: removedResidueComponents,
    },
  };
}
