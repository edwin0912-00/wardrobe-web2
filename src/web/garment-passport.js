export const GARMENT_CATEGORIES = Object.freeze(['outerwear', 'top', 'bottom', 'one_piece', 'footwear', 'headwear', 'bag', 'accessory']);

const GARMENT_REGION_LABELS = Object.freeze({
  outerwear: 'outerwear / upper-body layer',
  top: 'upper body / top',
  bottom: 'lower body / bottom',
  one_piece: 'one-piece garment',
  footwear: 'footwear',
  headwear: 'headwear',
  bag: 'bag',
  accessory: 'accessory',
});

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

export function groupGarmentViews(items, referenceSets = null) {
  const sets = Array.isArray(referenceSets) && referenceSets.length
    ? referenceSets
    : items.map((item) => ({ source_indexes: [item.source_index], primary_source_index: item.source_index, same_item_confidence: 1, evidence: ['legacy singleton view'] }));
  return sets.map((set) => {
    const views = set.source_indexes.map((index) => items.find((item) => item.source_index === index)).filter(Boolean);
    const primary = [...views].sort((a, b) => b.confidence - a.confidence || a.source_index - b.source_index)[0];
    return {
      ...primary,
      reference_set_id: `set-${set.source_indexes.slice().sort((a, b) => a - b).join('-')}`,
      source_index: set.primary_source_index,
      source_indexes: set.source_indexes.slice().sort((a, b) => a - b),
      same_item_confidence: set.same_item_confidence,
      grouping_evidence: set.evidence,
      confidence: Math.max(...views.map((item) => item.confidence)),
      observed: {
        garment_type: primary.observed.garment_type,
        colors: unique(views.flatMap((item) => item.observed.colors)),
        material: unique(views.flatMap((item) => item.observed.material)),
        pattern: unique(views.flatMap((item) => item.observed.pattern)),
        logo_text: unique(views.flatMap((item) => item.observed.logo_text)),
        construction: unique(views.flatMap((item) => item.observed.construction)),
      },
      unknowns: unique(views.flatMap((item) => item.unknowns)),
      blockers: unique(views.flatMap((item) => item.blockers)),
      view_categories: unique(views.map((item) => item.category)),
    };
  }).sort((a, b) => a.source_indexes[0] - b.source_indexes[0]);
}

export function findGarmentConflicts(items, referenceSets = null) {
  const conflicts = [];
  const groupedItems = groupGarmentViews(items, referenceSets);
  for (const item of groupedItems) {
    if (item.view_categories.length > 1) {
      conflicts.push({ type: 'GARMENT_GROUP_CATEGORY_CONFLICT', reference_set_id: item.reference_set_id, categories: item.view_categories, source_indexes: item.source_indexes });
    }
  }
  const byCategory = Map.groupBy(groupedItems, (item) => item.category);
  for (const [category, grouped] of byCategory) {
    if (!['accessory'].includes(category) && grouped.length > 1) {
      conflicts.push({ type: 'DUPLICATE_SLOT', category, source_indexes: grouped.flatMap((item) => item.source_indexes), reference_set_ids: grouped.map((item) => item.reference_set_id) });
    }
  }
  if ((byCategory.get('one_piece')?.length ?? 0) > 0
      && ((byCategory.get('top')?.length ?? 0) > 0 || (byCategory.get('bottom')?.length ?? 0) > 0)) {
    conflicts.push({
      type: 'ONE_PIECE_LAYER_CONFLICT',
      categories: ['one_piece', 'top', 'bottom'],
      source_indexes: groupedItems.filter((item) => ['one_piece', 'top', 'bottom'].includes(item.category)).flatMap((item) => item.source_indexes),
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

// A source photo often shows a complete person even when the user selected only
// one item from it.  The category extracted by the garment passport is the
// contract: incidental trousers, shoes, or other clothing visible in that
// source photo are not silently promoted into required look locks.
export function outfitTargetRegion(items) {
  const categories = unique(items.map((item) => item?.category))
    .filter((category) => GARMENT_CATEGORIES.includes(category));
  const labels = categories.map((category) => GARMENT_REGION_LABELS[category]);
  if (labels.length === 0) return 'the user-selected garment region';
  return `only the selected garment region${labels.length === 1 ? '' : 's'}: ${labels.join(', ')}. Clothing outside these selected regions is intentionally open and must not be treated as a required match merely because it appears in a source photo`;
}

export function compileFullLookText(items, supportingText = '') {
  const lines = items.flatMap((item) => garmentLocks(item).map((lock) => `[${item.category}] ${lock}`));
  return [
    supportingText.trim(),
    'Build one coherent look around the selected garment locks below.',
    `Scope: ${outfitTargetRegion(items)}.`,
    'A full-body source photo can contain incidental clothing outside that scope; it is not a target garment. Preserve or plausibly complete unselected clothing without treating it as a lock.',
    ...lines,
  ].filter(Boolean).join('\n');
}
