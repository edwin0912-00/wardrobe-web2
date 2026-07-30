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
  let relativeSubjectProtectionBbox = null;
  let gradientCleanupApplied = false;
  let gradientCleanupSkippedReason = null;
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
    const borderBand = Math.max(1, Math.round(width * 0.08));
    const relativeMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const background = [0, 0, 0];
      for (let x = 0; x < borderBand; x += 1) {
        const leftOffset = (y * width + x) * channels;
        const rightOffset = (y * width + width - x - 1) * channels;
        for (let channel = 0; channel < 3; channel += 1) {
          background[channel] += data[leftOffset + channel] + data[rightOffset + channel];
        }
      }
      for (let channel = 0; channel < 3; channel += 1) background[channel] /= borderBand * 2;
      for (let x = borderBand; x < width - borderBand; x += 1) {
        const index = y * width + x;
        if (visited[index]) continue;
        const offset = index * channels;
        const difference = Math.max(
          Math.abs(data[offset] - background[0]),
          Math.abs(data[offset + 1] - background[1]),
          Math.abs(data[offset + 2] - background[2]),
        );
        if (difference < 4) continue;
        relativeMask[index] = 1;
      }
    }
    const relativeLabels = new Int32Array(width * height);
    const relativeComponents = [];
    const enqueueRelative = (index, label) => {
      if (!relativeMask[index] || relativeLabels[index] !== 0) return;
      relativeLabels[index] = label;
      queue[tail++] = index;
    };
    for (let start = 0; start < relativeMask.length; start += 1) {
      if (!relativeMask[start] || relativeLabels[start] !== 0) continue;
      const label = relativeComponents.length + 1;
      head = 0;
      tail = 0;
      enqueueRelative(start, label);
      let pixels = 0;
      let left = width;
      let top = height;
      let right = -1;
      let bottom = -1;
      while (head < tail) {
        const index = queue[head++];
        pixels += 1;
        const x = index % width;
        const y = Math.floor(index / width);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
        for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
          for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
            if (xOffset === 0 && yOffset === 0) continue;
            const nextX = x + xOffset;
            const nextY = y + yOffset;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
            enqueueRelative(nextY * width + nextX, label);
          }
        }
      }
      relativeComponents.push({ label, pixels, left, top, right, bottom });
    }
    const centerX = width / 2;
    const minimumRelativePixels = Math.max(16, Math.round(width * height * 0.0025));
    const minimumAnchorPixels = Math.max(64, Math.round(width * height * 0.01));
    const compactRelativeComponents = relativeComponents.filter((component) => (
      component.pixels >= minimumRelativePixels
      && component.right - component.left + 1 < width * 0.8
      && component.bottom - component.top + 1 < height * 0.95
    ));
    const centralAnchors = compactRelativeComponents.filter((component) => (
      component.pixels >= minimumAnchorPixels
      && component.right - component.left + 1 >= width * 0.1
      && component.bottom - component.top + 1 >= height * 0.2
      && Math.max(0, component.left - centerX, centerX - component.right) <= width * 0.1
    ));
    if (centralAnchors.length > 0) {
      const anchorLeft = Math.min(...centralAnchors.map(({ left }) => left));
      const anchorTop = Math.min(...centralAnchors.map(({ top }) => top));
      const anchorRight = Math.max(...centralAnchors.map(({ right }) => right));
      const anchorBottom = Math.max(...centralAnchors.map(({ bottom }) => bottom));
      const centralComponents = compactRelativeComponents.filter((component) => {
        const overlapsHorizontally = component.right >= anchorLeft && component.left <= anchorRight;
        const verticalGap = Math.max(0, anchorTop - component.bottom - 1, component.top - anchorBottom - 1);
        return overlapsHorizontally && verticalGap <= height * 0.3;
      });
      const relativeLeft = Math.min(...centralComponents.map(({ left }) => left));
      const relativeTop = Math.min(...centralComponents.map(({ top }) => top));
      const relativeRight = Math.max(...centralComponents.map(({ right }) => right));
      const relativeBottom = Math.max(...centralComponents.map(({ bottom }) => bottom));
      relativeSubjectProtectionBbox = {
        left: relativeLeft,
        top: relativeTop,
        width: relativeRight - relativeLeft + 1,
        height: relativeBottom - relativeTop + 1,
      };
    }
    const gradientFloodSafe = protectedLightPrimaryLabel !== 0
      || relativeSubjectProtectionBbox !== null;
    gradientCleanupApplied = gradientFloodSafe;
    if (!gradientFloodSafe) {
      gradientCleanupSkippedReason = 'AMBIGUOUS_LOW_CONTRAST_SUBJECT';
    }
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
      const x = index % width;
      const y = Math.floor(index / width);
      const isRelativeSubject = relativeSubjectProtectionBbox
        && x >= relativeSubjectProtectionBbox.left
        && x < relativeSubjectProtectionBbox.left + relativeSubjectProtectionBbox.width
        && y >= relativeSubjectProtectionBbox.top
        && y < relativeSubjectProtectionBbox.top + relativeSubjectProtectionBbox.height;
      if (!protect(index) && !isProtectedLightPrimary && !isRelativeSubject) continue;
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
      return gradientFloodSafe
        && protectionDistance[index] === 0xff
        && Math.min(...values) >= gradientSeedMinimumChannel
        && Math.max(...values) - Math.min(...values) <= gradientSeedMaximumChroma;
    };
    const gradientNeighborQualifies = (index, previous) => {
      if (!gradientFloodSafe || visited[index] || protectionDistance[index] !== 0xff) return false;
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
      border_gradient_cleanup_applied: gradientCleanupApplied,
      gradient_cleanup_skipped_reason: gradientCleanupSkippedReason,
      removed_gradient_pixels: removedGradientPixels,
      relative_subject_protection_bbox: relativeSubjectProtectionBbox,
      removed_residue_pixels: removedResiduePixels,
      removed_residue_components: removedResidueComponents,
    },
  };
}
