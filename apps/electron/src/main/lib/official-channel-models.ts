import type { ChannelModel } from '@proma/shared'

const OFFICIAL_MODEL_CATALOG_LOCKED_MESSAGE = 'Proma Cloud 渠道的模型目录由 Proma 管理，无法编辑'

/**
 * The official catalog comes from Proma Cloud. Local settings may only toggle
 * an existing model; IDs, names and model capabilities are never user editable.
 */
export function applyOfficialModelEnabledStates(
  existingModels: ChannelModel[],
  requestedModels: ChannelModel[],
): ChannelModel[] {
  const requestedById = new Map(requestedModels.map((model) => [model.id, model]))
  if (requestedById.size !== requestedModels.length || requestedById.size !== existingModels.length) {
    throw new Error(OFFICIAL_MODEL_CATALOG_LOCKED_MESSAGE)
  }

  return existingModels.map((model) => {
    const requested = requestedById.get(model.id)
    if (!requested) throw new Error(OFFICIAL_MODEL_CATALOG_LOCKED_MESSAGE)
    return { ...model, enabled: requested.enabled }
  })
}

/**
 * Server snapshots are the source of truth for model metadata and membership.
 * Preserve only the user-owned enabled flag from a previously persisted catalog.
 */
export function preserveOfficialModelEnabledStates(
  catalogModels: ChannelModel[],
  persistedModels: ChannelModel[] = [],
): ChannelModel[] {
  const enabledById = new Map(persistedModels.map((model) => [model.id, model.enabled]))
  return catalogModels.map((model) => ({
    ...model,
    enabled: enabledById.get(model.id) ?? model.enabled,
  }))
}

export { OFFICIAL_MODEL_CATALOG_LOCKED_MESSAGE }
