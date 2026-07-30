import sharp from 'sharp';

export async function removeBorderConnectedWhiteToAlpha(input, {
  minimumChannel = 245,
  maximumChroma = 10,
  removeBorderConnectedNeutralGradient = false,
  gradientSeedMinimumChannel = 236,
  gradientSeedMaximumChroma = 16,
  gradientMinimumChannel = 198,
  gradientMaximumChroma = 18,
  gradientMaximumChannelStep = 12,
  gradientProtectionMinimumChannel = 190,
  gradientProtectionMaximumChroma = 24,
  gradientProtectionRadius = 1,
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
  let removedGradientPixels = 0;
  if (removeBorderConnectedNeutralGradient) {
    const preGradientLabels = new Int32Array(width * height);
    const preGradientComponents = [];
    const isPreGradientStrong = (index) => {
      const offset = index * channels;
      const values = [data[offset], data[offset + 1], data[offset + 2]];
      return Math.min(...values) < gradientProtectionMinimumChannel
        || Math.max(...values) - Math.min(...values) > gradientProtectionMaximumChroma;
    };
    const enqueuePreGradient = (index, label) => {
      if (visited[index] || preGradientLabels[index] !== 0) return;
      preGradientLabels[index] = label;
      queue[tail++] = index;
    };
    for (let start = 0; start < visited.length; start += 1) {
      if (visited[start] || preGradientLabels[start] !== 0) continue;
      const label = preGradientComponents.length + 1;
      head = 0;
      tail = 0;
      enqueuePreGradient(start, label);
      let pixels = 0;
      let strongPixels = 0;
      let touchesBorder = false;
      while (head < tail) {
        const index = queue[head++];
        pixels += 1;
        if (isPreGradientStrong(index)) strongPixels += 1;
        const x = index % width;
        const y = Math.floor(index / width);
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) touchesBorder = true;
        for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
          for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
            if (xOffset === 0 && yOffset === 0) continue;
            const nextX = x + xOffset;
            const nextY = y + yOffset;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
            enqueuePreGradient(nextY * width + nextX, label);
          }
        }
      }
      preGradientComponents.push({ label, pixels, strongPixels, touchesBorder });
    }
    const protectedLightPrimary = preGradientComponents
      .filter(({ touchesBorder }) => !touchesBorder)
      .reduce(
        (largest, component) => (!largest || component.pixels > largest.pixels ? component : largest),
        null,
      );
    const protectedLightPrimaryLabel = protectedLightPrimary
      && protectedLightPrimary.strongPixels / protectedLightPrimary.pixels < minimumStrongPixelRatio
      ? protectedLightPrimary.label
      : 0;
    const protectionDistance = new Uint8Array(width * height);
    protectionDistance.fill(0xff);
    const protect = (index) => {
      const offset = index * channels;
      const values = [data[offset], data[offset + 1], data[offset + 2]];
      return Math.min(...values) < gradientProtectionMinimumChannel
        || Math.max(...values) - Math.min(...values) > gradientProtectionMaximumChroma;
    };
    head = 0;
    tail = 0;
    for (let index = 0; index < visited.length; index += 1) {
      const isProtectedLightPrimary = protectedLightPrimaryLabel !== 0
        && preGradientLabels[index] === protectedLightPrimaryLabel;
      if (!protect(index) && !isProtectedLightPrimary) continue;
      protectionDistance[index] = 0;
      queue[tail++] = index;
    }
    while (head < tail) {
      const index = queue[head++];
      const distance = protectionDistance[index];
      if (distance >= gradientProtectionRadius) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          if (xOffset === 0 && yOffset === 0) continue;
          const nextX = x + xOffset;
          const nextY = y + yOffset;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (protectionDistance[next] <= distance + 1) continue;
          protectionDistance[next] = distance + 1;
          queue[tail++] = next;
        }
      }
    }
    const gradientSeedQualifies = (index) => {
      const offset = index * channels;
      const values = [data[offset], data[offset + 1], data[offset + 2]];
      return protectionDistance[index] === 0xff
        && Math.min(...values) >= gradientSeedMinimumChannel
        && Math.max(...values) - Math.min(...values) <= gradientSeedMaximumChroma;
    };
    const gradientNeighborQualifies = (index, previous) => {
      if (visited[index] || protectionDistance[index] !== 0xff) return false;
      const offset = index * channels;
      const previousOffset = previous * channels;
      const values = [data[offset], data[offset + 1], data[offset + 2]];
      return Math.min(...values) >= gradientMinimumChannel
        && Math.max(...values) - Math.min(...values) <= gradientMaximumChroma
        && Math.max(
          Math.abs(data[offset] - data[previousOffset]),
          Math.abs(data[offset + 1] - data[previousOffset + 1]),
          Math.abs(data[offset + 2] - data[previousOffset + 2]),
        ) <= gradientMaximumChannelStep;
    };
    head = 0;
    tail = 0;
    for (let index = 0; index < visited.length; index += 1) {
      if (visited[index]) queue[tail++] = index;
    }
    const enqueueGradientSeed = (index) => {
      if (visited[index] || !gradientSeedQualifies(index)) return;
      visited[index] = 1;
      removedGradientPixels += 1;
      queue[tail++] = index;
    };
    for (let x = 0; x < width; x += 1) {
      enqueueGradientSeed(x);
      enqueueGradientSeed((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueueGradientSeed(y * width);
      enqueueGradientSeed(y * width + width - 1);
    }
    const enqueueGradientNeighbor = (index, previous) => {
      if (!gradientNeighborQualifies(index, previous)) return;
      visited[index] = 1;
      removedGradientPixels += 1;
      queue[tail++] = index;
    };
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) enqueueGradientNeighbor(index - 1, index);
      if (x + 1 < width) enqueueGradientNeighbor(index + 1, index);
      if (y > 0) enqueueGradientNeighbor(index - width, index);
      if (y + 1 < height) enqueueGradientNeighbor(index + width, index);
    }
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
      components.push({ label, pixels, strongPixels, nearPrimaryStrongPixels: 0 });
    }
    const hasStrongForeground = components.some(({ strongPixels }) => strongPixels > 0);
    const primary = components.reduce(
      (largest, component) => (!largest || component.pixels > largest.pixels ? component : largest),
      null,
    );
    const proximityThreshold = Math.max(3, Math.round(Math.max(width, height) * 0.04));
    const primaryDistance = new Uint16Array(width * height);
    primaryDistance.fill(0xffff);
    head = 0;
    tail = 0;
    if (primary?.strongPixels > 0) {
      for (let index = 0; index < labels.length; index += 1) {
        if (labels[index] !== primary.label || !isStrongForeground(index)) continue;
        primaryDistance[index] = 0;
        queue[tail++] = index;
      }
      while (head < tail) {
        const index = queue[head++];
        const distance = primaryDistance[index];
        if (distance >= proximityThreshold) continue;
        const x = index % width;
        const y = Math.floor(index / width);
        for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
          for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
            if (xOffset === 0 && yOffset === 0) continue;
            const nextX = x + xOffset;
            const nextY = y + yOffset;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
            const next = nextY * width + nextX;
            if (primaryDistance[next] <= distance + 1) continue;
            primaryDistance[next] = distance + 1;
            queue[tail++] = next;
          }
        }
      }
      for (let index = 0; index < labels.length; index += 1) {
        const label = labels[index];
        if (label === 0 || label === primary.label || primaryDistance[index] > proximityThreshold) continue;
        components[label - 1].nearPrimaryStrongPixels += 1;
      }
    }
    const residueLabels = new Set(components
      .filter((component) => (
        hasStrongForeground
        && primary?.strongPixels > 0
        && component.label !== primary.label
        && component.pixels < primary.pixels * 0.5
        && component.strongPixels / component.pixels < minimumStrongPixelRatio
        && component.nearPrimaryStrongPixels / component.pixels < 0.25
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
      border_gradient_cleanup: removeBorderConnectedNeutralGradient,
      removed_gradient_pixels: removedGradientPixels,
      removed_residue_pixels: removedResiduePixels,
      removed_residue_components: removedResidueComponents,
    },
  };
}
