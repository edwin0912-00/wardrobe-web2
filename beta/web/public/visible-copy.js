const CHECKPOINT_ALIASES = Object.freeze({
  GARMENT_CONDITIONING: 'ITEM_FACTS',
  GARMENT_GROUPING: 'VIEW_GROUPING',
  GARMENT_GENERATING: 'ITEM_PREPARATION',
  GARMENT_QA: 'ITEM_QA',
});

/**
 * Keep persisted/API vocabulary stable while preventing it from leaking into
 * either the product UI or the engineering monitor.
 */
export function neutralizeItemTerms(value) {
  let result = String(value ?? '');
  for (const [internal, visible] of Object.entries(CHECKPOINT_ALIASES)) {
    result = result.replaceAll(internal, visible);
  }
  return result
    .replaceAll('GarmentNeedsInputError', 'ItemNeedsInputError')
    .replaceAll('GARMENTS', 'ITEMS')
    .replaceAll('GARMENT', 'ITEM')
    .replaceAll('Garments', 'Items')
    .replaceAll('Garment', 'Item')
    .replaceAll('garments', 'items')
    .replaceAll('garment', 'item');
}

/**
 * NEEDS_INPUT is a request to change the submitted material, not a transient
 * provider failure. Keep that distinction in one place so the terminal UI
 * never offers a retry that can only submit the identical incomplete set.
 */
export function needsInputPresentation(value) {
  const raw = String(value ?? '');
  const normalized = raw.toLowerCase();
  const onlyHeadwear = /(?:outfit|item) references? show only/.test(normalized)
    && /\b(?:hat|headwear|cap|beanie)\b/.test(normalized);

  if (onlyHeadwear) {
    return {
      title: 'Додай речі для повного образу',
      message: 'Зараз є лише головний убір. Додай фото верху, низу або цільного образу — тоді продовжимо.',
    };
  }

  return {
    title: 'Потрібні інші матеріали',
    message: neutralizeItemTerms(raw) || 'Додай або заміни матеріали — тоді продовжимо.',
  };
}
