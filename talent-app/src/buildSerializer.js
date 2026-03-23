import { SHARE_BUILD_QUERY_KEY, SHARE_BUILD_CODEC_VERSION, BLUEPRINT_MODEL_ID } from './constants.js'
import {
  normalizeTalentState,
  ensureCreatureArchetypeBuild,
  getScopedArchetypeTalentState,
  normalizeShareMetadata,
  countMissingPrerequisitesInBuild
} from './buildUtils.js'
import { normalizePlayerModifierIds } from './modifierUtils.js'

export function encodeUtf8Base64Url(value) {
  const textEncoder = new TextEncoder()
  const bytes = textEncoder.encode(String(value))
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function decodeBase64UrlUtf8(value) {
  const normalized = String(value)
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  const textDecoder = new TextDecoder()
  return textDecoder.decode(bytes)
}

export function encodeSharedBuildPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  try {
    return encodeUtf8Base64Url(JSON.stringify(payload))
  } catch {
    return ''
  }
}

export function extractVersionFromShareParam(search) {
  try {
    const params = new URLSearchParams(search)
    const encoded = params.get(SHARE_BUILD_QUERY_KEY)
    if (!encoded) return null
    const parsed = JSON.parse(decodeBase64UrlUtf8(encoded))
    return typeof parsed?.v === 'string' ? parsed.v : null
  } catch {
    return null
  }
}

export function createShareBuildPayload({
  modelId,
  archetypeId,
  skilledTalents,
  playerModifierIds,
  playerTalentModifiers,
  models,
  schemaVersion,
  metadata,
  versionId
}) {
  const normalizedModelId = modelId === 'Creature'
    ? 'Creature'
    : (modelId === BLUEPRINT_MODEL_ID ? BLUEPRINT_MODEL_ID : 'Player')
  const selectedModel = models?.[normalizedModelId]

  const resolvedArchetypeId = normalizedModelId === 'Creature' || normalizedModelId === BLUEPRINT_MODEL_ID
    ? (selectedModel?.archetypes?.[archetypeId] ? archetypeId : (Object.values(selectedModel?.archetypes ?? {})[0]?.id ?? ''))
    : (archetypeId || '')

  const normalizedTalents = normalizedModelId === 'Creature'
    ? ensureCreatureArchetypeBuild(skilledTalents ?? {}, selectedModel, resolvedArchetypeId)
    : (normalizedModelId === BLUEPRINT_MODEL_ID
      ? getScopedArchetypeTalentState(skilledTalents ?? {}, selectedModel, resolvedArchetypeId)
      : normalizeTalentState(skilledTalents ?? {}))

  const sharePayload = {
    cv: SHARE_BUILD_CODEC_VERSION,
    sv: Number.isFinite(Number(schemaVersion)) ? Number(schemaVersion) : null,
    v: typeof versionId === 'string' ? versionId : null,
    m: normalizedModelId,
    a: resolvedArchetypeId,
    t: normalizedTalents
  }

  if (normalizedModelId === 'Player') {
    sharePayload.pm = normalizePlayerModifierIds(playerModifierIds, playerTalentModifiers)
  }

  const normalizedMetadata = normalizeShareMetadata(metadata)
  if (normalizedMetadata) {
    sharePayload.n = normalizedMetadata.title
    sharePayload.d = normalizedMetadata.description
  }

  return sharePayload
}

export function createShareUrlFromPayload(payload) {
  const encodedPayload = encodeSharedBuildPayload(payload)
  if (!encodedPayload) {
    return null
  }

  const shareUrl = new URL(window.location.href)
  shareUrl.searchParams.set(SHARE_BUILD_QUERY_KEY, encodedPayload)
  return shareUrl
}

export function parseSharedBuildFromSearch(searchValue, { models, schemaVersion, playerTalentModifiers }) {
  if (typeof searchValue !== 'string') {
    return {
      hasSharedBuildParam: false,
      errorCode: '',
      warnings: [],
      metadata: null,
      build: null
    }
  }

  const params = new URLSearchParams(searchValue)
  const encodedBuild = params.get(SHARE_BUILD_QUERY_KEY)

  if (encodedBuild === null) {
    return {
      hasSharedBuildParam: false,
      errorCode: '',
      warnings: [],
      metadata: null,
      build: null
    }
  }

  if (!encodedBuild) {
    return {
      hasSharedBuildParam: true,
      errorCode: 'incomplete',
      warnings: [],
      metadata: null,
      build: null
    }
  }

  let decodedText
  try {
    decodedText = decodeBase64UrlUtf8(encodedBuild)
  } catch {
    return {
      hasSharedBuildParam: true,
      errorCode: 'corrupted',
      warnings: [],
      metadata: null,
      build: null
    }
  }

  if (!decodedText) {
    return {
      hasSharedBuildParam: true,
      errorCode: 'incomplete',
      warnings: [],
      metadata: null,
      build: null
    }
  }

  let parsed
  try {
    parsed = JSON.parse(decodedText)
  } catch {
    return {
      hasSharedBuildParam: true,
      errorCode: 'corrupted',
      warnings: [],
      metadata: null,
      build: null
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      hasSharedBuildParam: true,
      errorCode: 'incomplete',
      warnings: [],
      metadata: null,
      build: null
    }
  }

  const modelId = parsed.m === 'Creature'
    ? 'Creature'
    : (parsed.m === BLUEPRINT_MODEL_ID ? BLUEPRINT_MODEL_ID : (parsed.m === 'Player' ? 'Player' : ''))
  if (!modelId || !models?.[modelId]) {
    return {
      hasSharedBuildParam: true,
      errorCode: 'invalidModel',
      warnings: [],
      metadata: null,
      build: null
    }
  }

  const model = models[modelId]
  const rawTalents = normalizeTalentState(parsed.t)
  if (!parsed.t || typeof parsed.t !== 'object') {
    return {
      hasSharedBuildParam: true,
      errorCode: 'incomplete',
      warnings: [],
      metadata: null,
      build: null
    }
  }

  let resolvedArchetypeId = typeof parsed.a === 'string' ? parsed.a : ''
  const warnings = []

  if (modelId === 'Creature' || modelId === BLUEPRINT_MODEL_ID) {
    const fallbackArchetypeId = Object.values(model.archetypes ?? {})[0]?.id ?? ''
    if (!model.archetypes?.[resolvedArchetypeId]) {
      warnings.push(
        modelId === 'Creature'
          ? 'This shared build references a creature archetype that no longer exists. A fallback archetype is shown.'
          : 'This shared build references a tech tier that no longer exists. A fallback tier is shown.'
      )
      resolvedArchetypeId = fallbackArchetypeId
    }
  }

  const normalizedTalents = modelId === 'Creature'
    ? ensureCreatureArchetypeBuild(rawTalents, model, resolvedArchetypeId)
    : (modelId === BLUEPRINT_MODEL_ID
      ? getScopedArchetypeTalentState(rawTalents, model, resolvedArchetypeId)
      : rawTalents)
  const normalizedPlayerModifierIds = modelId === 'Player'
    ? normalizePlayerModifierIds(parsed.pm, playerTalentModifiers)
    : []

  const codecVersion = Number(parsed.cv)
  if (!Number.isFinite(codecVersion) || codecVersion < 1) {
    warnings.push('This shared build uses an outdated share format version.')
  }

  const payloadSchemaVersion = Number(parsed.sv)
  const currentSchemaVersion = Number(schemaVersion)
  if (Number.isFinite(payloadSchemaVersion) && Number.isFinite(currentSchemaVersion) && payloadSchemaVersion !== currentSchemaVersion) {
    warnings.push('This shared build was created for a different talent data version.')
  }

  const missingPrerequisiteCount = countMissingPrerequisitesInBuild(normalizedTalents, model)
  if (missingPrerequisiteCount > 0) {
    warnings.push(
      `${missingPrerequisiteCount} selected talent${missingPrerequisiteCount === 1 ? ' is' : 's are'} missing prerequisites in the current data.`
    )
  }

  const metadata = normalizeShareMetadata({
    title: parsed.n,
    description: parsed.d
  })

  return {
    hasSharedBuildParam: true,
    errorCode: '',
    warnings,
    metadata,
    build: {
      modelId,
      archetypeId: resolvedArchetypeId,
      skilledTalents: normalizedTalents,
      playerModifierIds: normalizedPlayerModifierIds
    }
  }
}
