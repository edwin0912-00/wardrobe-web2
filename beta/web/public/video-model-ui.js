export function videoModelOptions(capability) {
  return Array.isArray(capability?.video_models)
    ? capability.video_models.filter((model) => (
      typeof model?.id === 'string' && typeof model?.label === 'string'
    ))
    : [];
}

export function resolveVideoModelId(capability, requestedModelId = null) {
  const models = videoModelOptions(capability);
  if (models.some((model) => model.id === requestedModelId)) return requestedModelId;
  return models.find((model) => model.default === true)?.id
    ?? models[0]?.id
    ?? 'seedance-2.0';
}

export function videoModelLabel(capability, modelId) {
  if (typeof modelId !== 'string' || modelId.length === 0) return null;
  return videoModelOptions(capability).find((model) => model.id === modelId)?.label ?? modelId;
}

export function videoStyleAvailability(style, modelId) {
  const models = style?.video_models;
  if (!Array.isArray(models) || models.length === 0) return { available: true, reason: '' };
  const model = models.find((entry) => entry?.id === modelId);
  if (!model) return { available: false, reason: 'Ця модель недоступна для вибраного стилю.' };
  return {
    available: model.available === true,
    reason: model.available === true
      ? ''
      : (typeof model.reason_uk === 'string' && model.reason_uk)
        || 'Ця модель недоступна для вибраного стилю.',
  };
}

export function realtimeLookStatusLabel({ paidLiveReady, blockedReason } = {}) {
  if (typeof blockedReason === 'string' && blockedReason.trim()) return blockedReason;
  return paidLiveReady ? 'Камера й AI доступні' : 'Камера доступна · AI тимчасово ні';
}
