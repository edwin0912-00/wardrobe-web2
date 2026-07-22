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
