export const GARMENT_CATEGORIES = Object.freeze(['outerwear', 'top', 'bottom', 'one_piece', 'footwear', 'headwear', 'bag', 'accessory']);

export function findGarmentConflicts(items) {
  const conflicts = [];
  const byCategory = Map.groupBy(items, (item) => item.category);
  for (const [category, grouped] of byCategory) {
    if (!['accessory'].includes(category) && grouped.length > 1) {
      conflicts.push({ type: 'DUPLICATE_SLOT', category, source_indexes: grouped.map((item) => item.source_index) });
    }
  }
  if ((byCategory.get('one_piece')?.length ?? 0) > 0
      && ((byCategory.get('top')?.length ?? 0) > 0 || (byCategory.get('bottom')?.length ?? 0) > 0)) {
    conflicts.push({
      type: 'ONE_PIECE_LAYER_CONFLICT',
      categories: ['one_piece', 'top', 'bottom'],
      source_indexes: items.filter((item) => ['one_piece', 'top', 'bottom'].includes(item.category)).map((item) => item.source_index),
    });
  }
  return conflicts;
}

export function garmentLocks(item) {
  const observed = item.observed;
  return [
    `${item.category}: ${observed.garment_type}`,
    `colors: ${observed.colors.join(', ')}`,
    observed.material.length ? `material: ${observed.material.join(', ')}` : null,
    observed.pattern.length ? `pattern: ${observed.pattern.join(', ')}` : null,
    observed.logo_text.length ? `exact logo/text: ${observed.logo_text.join(' | ')}` : null,
    observed.construction.length ? `construction: ${observed.construction.join(', ')}` : null,
  ].filter(Boolean);
}

export function compileFullLookText(items, supportingText = '') {
  const lines = items.flatMap((item) => garmentLocks(item).map((lock) => `[${item.category}] ${lock}`));
  return [supportingText.trim(), 'Build one coherent full look from every approved garment reference:', ...lines].filter(Boolean).join('\n');
}
