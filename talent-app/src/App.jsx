import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BR, CN, DE, ES, FR, GB, JP, KR, RU, TW } from 'country-flag-icons/react/3x2'
import { Check, ChevronLeft, ChevronRight, FolderOpen, Github, Save, Share2, Trash2 } from 'lucide-react'
import '@fontsource/orbitron/800.css'
import './App.css'
import TalentTreeCanvas from './TalentTreeCanvas'

const resolveAppUrl = (relativePath) => new URL(relativePath, document.baseURI).toString()
const DATA_URL = resolveAppUrl('Data/talents.json')
const BLUEPRINT_DATA_URL = resolveAppUrl('Data/blueprints.json')
const LOCALE_BASE_URL = resolveAppUrl('Exports/Icarus/Content/Localization/Game')
const LOCALE_CONFIG_URL = `${LOCALE_BASE_URL}/Game.json`
const MODIFIER_LABELS_URL = resolveAppUrl('Data/Localization/en.json')
const DEFAULT_LOCALE = 'en'
const LOCALE_COOKIE_NAME = 'talent_locale'
const SAVED_BUILDS_STORAGE_KEY = 'talent_saved_builds_v1'
const ACTIVE_BUILD_STORAGE_KEY = 'talent_active_builds_v2'
const SHARE_BUILD_QUERY_KEY = 'build'
const SHARE_BUILD_CODEC_VERSION = 1
const SAVED_BUILD_ACTION_FEEDBACK_MS = 1800
const SAVED_BUILD_DELETE_ANIMATION_MS = 1950
const ENABLED_MODELS = ['Player', 'Creature']
const BLUEPRINT_MODEL_ID = 'Blueprint'
const RANK_INVESTMENTS = {
  Novice: 0,
  Apprentice: 4,
  Journeyman: 8,
  Master: 12
}
const MAX_TALENT_POINTS = 90
const MAX_SOLO_POINTS = 30
const CREATURE_MOUNT_LEVEL_CAP = 50
const CREATURE_PET_LEVEL_CAP = 25
const CREATURE_BASE_ARCHETYPE_ID = 'Creature_Base'
const HIDDEN_CREATURE_ARCHETYPE_IDS = new Set([CREATURE_BASE_ARCHETYPE_ID])
const CREATURE_TAB_GROUPS = [
  {
    id: 'mount',
    label: 'Mounts',
    icon: '/Game/Assets/2DArt/UI/Icons/Icon_Speed.Icon_Speed'
  },
  {
    id: 'combatPet',
    label: 'Tames',
    icon: '/Game/Assets/2DArt/UI/Icons/Icon_AggressiveCreature.Icon_AggressiveCreature'
  },
  {
    id: 'regularPet',
    label: 'Livestock',
    icon: '/Game/Assets/2DArt/UI/Icons/T_Icon_Homestead.T_Icon_Homestead'
  }
]
const GITHUB_REPO_URL = 'https://github.com/StationSideNet/icarus-tools'
const ROCKETWERKZ_URL = 'https://rocketwerkz.com/'
const ICARUS_STEAM_URL = 'https://store.steampowered.com/sale/icarus'
const TOP_MENU_ICON_UNREAL_PATHS = {
  Player: '/Game/Assets/2DArt/UI/Icons/Icon_Solo.Icon_Solo',
  Creature: '/Game/Assets/2DArt/UI/Icons/T_ICON_Paws.T_ICON_Paws',
  TechTree: '/Game/Assets/2DArt/UI/Icons/T_Icon_TechTree.T_Icon_TechTree',
  Workshop: '/Game/Assets/2DArt/UI/Icons/Icon_RenCurrency.Icon_RenCurrency'
}
const LOCALE_FLAG_COMPONENTS = {
  'de-DE': DE,
  en: GB,
  'es-419': ES,
  'fr-FR': FR,
  'ja-JP': JP,
  'ko-KR': KR,
  'pt-BR': BR,
  'ru-RU': RU,
  'zh-Hans': CN,
  'zh-Hant': TW
}

function BrandName() {
  return (
    <div className="brand" aria-label="ICARUS // TOOLS // TALENTS">
      <span className="brand-word brand-word-icarus">ICARUS</span>
      <span className="brand-separator brand-separator-left">//</span>
      <span className="brand-word brand-word-tools">TOOLS</span>
      <span className="brand-separator brand-separator-right">//</span>
      <span className="brand-word brand-word-talents">TALENTS</span>
    </div>
  )
}

function MenuItemLabel({ iconPath, label }) {
  return (
    <span className="menu-link-content">
      {iconPath ? (
        <img
          src={iconPath}
          alt=""
          className="menu-link-icon"
          onError={(event) => {
            event.target.style.display = 'none'
          }}
        />
      ) : null}
      <span>{label}</span>
    </span>
  )
}

function mergeDatasets(talentsData, blueprintsData) {
  const baseTalents = talentsData && typeof talentsData === 'object' ? talentsData : {}
  const blueprintData = blueprintsData && typeof blueprintsData === 'object' ? blueprintsData : null

  if (!blueprintData?.models) {
    return baseTalents
  }

  return {
    ...baseTalents,
    models: {
      ...(baseTalents.models ?? {}),
      ...Object.fromEntries(
        Object.entries(blueprintData.models).filter(([modelId]) => modelId === BLUEPRINT_MODEL_ID)
      )
    },
    ranks: (baseTalents.ranks && Object.keys(baseTalents.ranks).length > 0)
      ? baseTalents.ranks
      : (blueprintData.ranks ?? {}),
    schemaVersion: Number.isFinite(Number(baseTalents.schemaVersion))
      ? Number(baseTalents.schemaVersion)
      : Number(blueprintData.schemaVersion)
  }
}

function App() {
  const [data, setData] = useState(null)
  const [locale, setLocale] = useState(() => getSavedLocaleFromCookie() || DEFAULT_LOCALE)
  const [availableLocales, setAvailableLocales] = useState([DEFAULT_LOCALE])
  const [localeStrings, setLocaleStrings] = useState({})
  const [modifierLabels, setModifierLabels] = useState({})
  const localeCacheRef = useRef({})
  const [modelId, setModelId] = useState('Player')
  const [archetypeId, setArchetypeId] = useState('')
  const [skilledTalents, setSkilledTalents] = useState({})
  const [decodeBuildError, setDecodeBuildError] = useState('')
  const [buildWarnings, setBuildWarnings] = useState([])
  const [saveState, setSaveState] = useState('idle')
  const [shareState, setShareState] = useState('idle')
  const [resetState, setResetState] = useState('idle')
  const [savedBuilds, setSavedBuilds] = useState(() => readSavedBuildsFromStorage())
  const [pendingSharedMetadata, setPendingSharedMetadata] = useState(null)
  const [saveDuplicateMatch, setSaveDuplicateMatch] = useState(null)
  const [savedBuildLoadStateById, setSavedBuildLoadStateById] = useState({})
  const [savedBuildShareStateById, setSavedBuildShareStateById] = useState({})
  const [savedBuildDeleteStateById, setSavedBuildDeleteStateById] = useState({})
  const [savedBuildTooltip, setSavedBuildTooltip] = useState(null)
  const activeBuildsRef = useRef(readActiveBuildsFromStorage())
  const savedBuildLoadTimeoutsRef = useRef({})
  const savedBuildShareTimeoutsRef = useRef({})
  const savedBuildDeleteTimeoutsRef = useRef({})
  const [hasHydratedActiveBuild, setHasHydratedActiveBuild] = useState(false)
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false)
  const [saveDialogTitle, setSaveDialogTitle] = useState('')
  const [saveDialogDescription, setSaveDialogDescription] = useState('')
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)
  const [isDisclaimerDialogOpen, setIsDisclaimerDialogOpen] = useState(false)
  const [isSavedBuildsSidebarCollapsed, setIsSavedBuildsSidebarCollapsed] = useState(false)
  const [isEffectsSidebarCollapsed, setIsEffectsSidebarCollapsed] = useState(false)
  const [includeSoloEffects, setIncludeSoloEffects] = useState(true)
  const [selectedPlayerModifierIds, setSelectedPlayerModifierIds] = useState([])
  const [selectedCreatureMetaGroupId, setSelectedCreatureMetaGroupId] = useState('mount')
  const topMenuIcons = useMemo(() => ({
    Player: resolveAssetImagePath(TOP_MENU_ICON_UNREAL_PATHS.Player) || '',
    Creature: resolveAssetImagePath(TOP_MENU_ICON_UNREAL_PATHS.Creature) || '',
    TechTree: resolveAssetImagePath(TOP_MENU_ICON_UNREAL_PATHS.TechTree) || '',
    Workshop: resolveAssetImagePath(TOP_MENU_ICON_UNREAL_PATHS.Workshop) || ''
  }), [])

  const getHumanErrorMessage = (errorCode) => {
    const messages = {
      corrupted: 'The build code is damaged or invalid.',
      incomplete: 'The build code is incomplete or cut off.',
      incompatible: 'This build is from an older version and cannot be loaded.',
      invalidModel: 'This link references a model that is not available.',
      overcap:
        'This build uses more points than the game allows. It is loaded for review, but you cannot add more points until it is within the limits.',
      default: 'Could not load your build. Try creating a new one.'
    }
    return messages[errorCode] || messages.default
  }

  useEffect(() => {
    let active = true

    const loadData = async () => {
      const talentsResponse = await fetch(DATA_URL)
      const talentsJson = await talentsResponse.json()

      let blueprintsJson = null
      try {
        const blueprintsResponse = await fetch(BLUEPRINT_DATA_URL)
        if (blueprintsResponse.ok) {
          blueprintsJson = await blueprintsResponse.json()
        }
      } catch (error) {
        console.warn('Blueprint data not available, Tech Tree mode will be disabled.', error)
      }

      if (!active) return
      setData(mergeDatasets(talentsJson, blueprintsJson))
    }

    loadData().catch((err) => console.error('Failed to load data', err))

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    writeSavedBuildsToStorage(savedBuilds)
  }, [savedBuilds])

  useEffect(() => {
    if (!data?.models || hasHydratedActiveBuild) return

    const sharedBuildResult = parseSharedBuildFromSearch(window.location.search, {
      models: data.models,
      schemaVersion: data.schemaVersion,
      playerTalentModifiers: data.playerTalentModifiers
    })

    if (sharedBuildResult.hasSharedBuildParam) {
      setDecodeBuildError(sharedBuildResult.errorCode || '')
      setBuildWarnings(sharedBuildResult.warnings)
      setPendingSharedMetadata(sharedBuildResult.metadata)

      if (sharedBuildResult.build) {
        const sharedBuild = sharedBuildResult.build
        const nextModel = data.models[sharedBuild.modelId]
        const nextPlayerModifierIds = normalizePlayerModifierIds(
          sharedBuild.playerModifierIds,
          data.playerTalentModifiers
        )
        const hasOvercap = sharedBuild.modelId === 'Creature'
          ? hasCreatureOvercap(sharedBuild.skilledTalents, nextModel)
          : (sharedBuild.modelId === 'Player' && hasPlayerOvercap(
            sharedBuild.skilledTalents,
            nextModel,
            getMaxPlayerTalentPoints(nextPlayerModifierIds, data.playerTalentModifiers)
          ))

        setModelId(sharedBuild.modelId)
        setArchetypeId(sharedBuild.archetypeId)
        setSkilledTalents(sharedBuild.skilledTalents)
        setSelectedPlayerModifierIds(nextPlayerModifierIds)
        setDecodeBuildError((previousErrorCode) => (
          previousErrorCode || (hasOvercap ? 'overcap' : '')
        ))
        setHasHydratedActiveBuild(true)
        return
      }
    }

    const activeBuilds = activeBuildsRef.current
    const requestedModelId = activeBuilds?.lastContext?.modelId
    const initialModelId = data.models?.[requestedModelId] ? requestedModelId : 'Player'

    if (initialModelId === BLUEPRINT_MODEL_ID) {
      const blueprintModel = data.models[BLUEPRINT_MODEL_ID]
      const requestedArchetypeId = activeBuilds?.lastContext?.archetypeId || ''
      const fallbackArchetypeId = Object.values(blueprintModel?.archetypes ?? {})[0]?.id ?? ''
      const resolvedArchetypeId = blueprintModel?.archetypes?.[requestedArchetypeId]
        ? requestedArchetypeId
        : fallbackArchetypeId
      const blueprintDraft = getScopedArchetypeTalentState(
        activeBuilds?.blueprints?.[resolvedArchetypeId]?.skilledTalents ?? {},
        blueprintModel,
        resolvedArchetypeId
      )

      setBuildWarnings([])
      setPendingSharedMetadata(getActiveBuildMetadata(activeBuilds, BLUEPRINT_MODEL_ID, resolvedArchetypeId))
      setModelId(BLUEPRINT_MODEL_ID)
      setArchetypeId(resolvedArchetypeId)
      setSkilledTalents(blueprintDraft)
      setSelectedPlayerModifierIds([])
      setDecodeBuildError('')
      setHasHydratedActiveBuild(true)
      return
    }

    const playerModel = data.models.Player
    const playerDraft = activeBuilds?.player?.skilledTalents ?? {}
    const playerArchetypeId = activeBuilds?.player?.archetypeId ?? ''
    const playerModifierIds = normalizePlayerModifierIds(
      activeBuilds?.player?.modifierIds,
      data.playerTalentModifiers
    )

    setBuildWarnings([])
    setPendingSharedMetadata(getActiveBuildMetadata(activeBuilds, 'Player', playerArchetypeId))
    setModelId('Player')
    setArchetypeId(playerArchetypeId)
    setSkilledTalents(playerDraft)
    setSelectedPlayerModifierIds(playerModifierIds)
    setDecodeBuildError(
      playerModel && hasPlayerOvercap(
        playerDraft,
        playerModel,
        getMaxPlayerTalentPoints(playerModifierIds, data.playerTalentModifiers)
      )
        ? 'overcap'
        : ''
    )
    setHasHydratedActiveBuild(true)
  }, [data, hasHydratedActiveBuild])

  useEffect(() => {
    if (!hasHydratedActiveBuild) return

    const nextActiveBuilds = createNextActiveBuildsSnapshot({
      previous: activeBuildsRef.current,
      modelId,
      archetypeId,
      skilledTalents,
      selectedPlayerModifierIds,
      models: data?.models,
      metadata: pendingSharedMetadata
    })

    activeBuildsRef.current = nextActiveBuilds
    writeActiveBuildsToStorage(nextActiveBuilds)
  }, [
    archetypeId,
    data?.models,
    hasHydratedActiveBuild,
    modelId,
    pendingSharedMetadata,
    selectedPlayerModifierIds,
    skilledTalents
  ])

  useEffect(() => {
    if (!hasHydratedActiveBuild || !data?.models) return

    const shareBuildPayload = createShareBuildPayload({
      modelId,
      archetypeId,
      skilledTalents,
      playerModifierIds: selectedPlayerModifierIds,
      playerTalentModifiers: data.playerTalentModifiers,
      models: data.models,
      schemaVersion: data.schemaVersion,
      metadata: pendingSharedMetadata
    })

    const encodedPayload = encodeSharedBuildPayload(shareBuildPayload)
    const nextUrl = new URL(window.location.href)
    const shouldKeepBuildParam = hasMeaningfulBuildState({
      modelId,
      archetypeId,
      skilledTalents,
      selectedPlayerModifierIds,
      models: data.models
    })

    const currentPayload = nextUrl.searchParams.get(SHARE_BUILD_QUERY_KEY)
    if (!shouldKeepBuildParam) {
      if (currentPayload === null) return
      nextUrl.searchParams.delete(SHARE_BUILD_QUERY_KEY)
      window.history.replaceState({}, '', nextUrl)
      return
    }

    if (!encodedPayload || currentPayload === encodedPayload) return

    nextUrl.searchParams.set(SHARE_BUILD_QUERY_KEY, encodedPayload)
    window.history.replaceState({}, '', nextUrl)
  }, [
    archetypeId,
    data?.models,
    data?.playerTalentModifiers,
    data?.schemaVersion,
    hasHydratedActiveBuild,
    modelId,
    pendingSharedMetadata,
    selectedPlayerModifierIds,
    skilledTalents
  ])

  useEffect(() => {
    let active = true

    fetchModifierLabels()
      .then((labels) => {
        if (!active) return
        setModifierLabels(labels ?? {})
      })
      .catch((err) => {
        console.error('Failed to load modifier labels', err)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    fetchLocaleManifest()
      .then((manifest) => {
        if (!active || !manifest) return

        const localeSet = new Set([
          ...(manifest.compiledCultures ?? []),
          manifest.nativeCulture,
          DEFAULT_LOCALE
        ].filter(Boolean))

        const nextLocales = Array.from(localeSet)
        if (nextLocales.length > 0) {
          setAvailableLocales(nextLocales)
          setLocale((previousLocale) => (
            localeSet.has(previousLocale) ? previousLocale : DEFAULT_LOCALE
          ))
        }
      })
      .catch((err) => {
        console.error('Failed to load locale manifest', err)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    const cached = localeCacheRef.current[locale]
    if (cached) {
      setLocaleStrings(cached)
      return () => {
        active = false
      }
    }

    const loadLocale = async () => {
      const requested = await fetchLocaleStrings(locale)
      if (requested && active) {
        localeCacheRef.current[locale] = requested
        setLocaleStrings(requested)
        return
      }

      if (locale !== DEFAULT_LOCALE) {
        const fallback = await fetchLocaleStrings(DEFAULT_LOCALE)
        if (fallback && active) {
          localeCacheRef.current[DEFAULT_LOCALE] = fallback
          setLocaleStrings(fallback)
        }
      }
    }

    loadLocale().catch((err) => {
      console.error(`Failed to load locale '${locale}'`, err)
    })

    return () => {
      active = false
    }
  }, [locale])

  useEffect(() => {
    if (!locale) return
    setLocaleCookie(locale)
  }, [locale])

  const models = useMemo(() => {
    if (!data?.models) return []
    return Object.values(data.models).filter((model) => ENABLED_MODELS.includes(model.id))
  }, [data])

  const selectedModel = useMemo(() => {
    return data?.models?.[modelId] ?? null
  }, [data, modelId])

  const archetypes = useMemo(() => {
    if (!selectedModel?.archetypes) return []
    const allArchetypes = Object.values(selectedModel.archetypes)

    if (selectedModel.id !== 'Creature') {
      return allArchetypes
    }

    return allArchetypes.filter((item) => !HIDDEN_CREATURE_ARCHETYPE_IDS.has(item.id))
  }, [selectedModel])

  const selectedArchetype = useMemo(() => {
    return archetypes.find((item) => item.id === archetypeId) ?? archetypes[0] ?? null
  }, [archetypeId, archetypes])

  const trees = useMemo(() => {
    if (!selectedArchetype?.trees) return []
    return Object.values(selectedArchetype.trees)
  }, [selectedArchetype])

  const treeArchetypeMap = useMemo(() => {
    const map = {}
    const archetypeEntries = Object.values(selectedModel?.archetypes ?? {})
    archetypeEntries.forEach((archetype) => {
      Object.values(archetype.trees ?? {}).forEach((tree) => {
        map[tree.id] = archetype.id
      })
    })
    return map
  }, [selectedModel])

  const treeLookup = useMemo(() => {
    const map = {}
    Object.values(selectedModel?.archetypes ?? {}).forEach((archetype) => {
      Object.values(archetype.trees ?? {}).forEach((tree) => {
        map[tree.id] = tree
      })
    })
    return map
  }, [selectedModel])

  const isCreatureModel = modelId === 'Creature'
  const isBlueprintModel = modelId === BLUEPRINT_MODEL_ID

  const creatureTreeProgressById = useMemo(
    () => getCreatureTreeProgressById(selectedModel),
    [selectedModel]
  )

  const creatureOriginTalentByTree = useMemo(
    () => getCreatureOriginTalentByTree(selectedModel),
    [selectedModel]
  )

  const getTreePoints = useCallback((treeId) => {
    const treeTalents = skilledTalents[treeId] ?? {}
    const excludedTalentId = modelId === 'Creature' ? creatureOriginTalentByTree[treeId] : null
    return getTreeTalentPoints(treeTalents, excludedTalentId)
  }, [creatureOriginTalentByTree, modelId, skilledTalents])

  const getIsSoloTree = (treeId) => treeArchetypeMap[treeId] === 'Solo'

  const pointsSummary = useMemo(
    () => summarizeTalentPoints(skilledTalents, treeArchetypeMap, modelId === 'Creature' ? creatureOriginTalentByTree : null),
    [creatureOriginTalentByTree, modelId, skilledTalents, treeArchetypeMap]
  )
  const normalizedSelectedPlayerModifierIds = useMemo(
    () => normalizePlayerModifierIds(selectedPlayerModifierIds, data?.playerTalentModifiers),
    [data?.playerTalentModifiers, selectedPlayerModifierIds]
  )
  const playerBonusTalentPoints = useMemo(
    () => getPlayerTalentPointBonus(normalizedSelectedPlayerModifierIds, data?.playerTalentModifiers),
    [data?.playerTalentModifiers, normalizedSelectedPlayerModifierIds]
  )
  const maxPlayerTalentPoints = MAX_TALENT_POINTS + playerBonusTalentPoints
  const hasSpentPoints = pointsSummary.talentPoints > 0 || pointsSummary.soloPoints > 0

  useEffect(() => {
    if (!data?.playerTalentModifiers) return
    setSelectedPlayerModifierIds((previousIds) => {
      return normalizePlayerModifierIds(previousIds, data.playerTalentModifiers)
    })
  }, [data?.playerTalentModifiers])

  const selectedCreatureTree = useMemo(
    () => (isCreatureModel ? trees[0] ?? null : null),
    [isCreatureModel, trees]
  )

  const selectedCreatureProgress = useMemo(() => {
    if (!isCreatureModel || !selectedCreatureTree) {
      return {
        category: 'mount',
        levelCap: CREATURE_MOUNT_LEVEL_CAP,
        points: 0
      }
    }

    const progress = creatureTreeProgressById[selectedCreatureTree.id] ?? {
      category: 'mount',
      levelCap: CREATURE_MOUNT_LEVEL_CAP
    }

    return {
      ...progress,
      points: getTreePoints(selectedCreatureTree.id)
    }
  }, [creatureTreeProgressById, getTreePoints, isCreatureModel, selectedCreatureTree])

  const creatureArchetypesByCategory = useMemo(() => {
    if (!isCreatureModel) {
      return {
        mount: [],
        combatPet: [],
        regularPet: []
      }
    }

    return groupCreatureArchetypesByCategory(archetypes, creatureTreeProgressById)
  }, [archetypes, creatureTreeProgressById, isCreatureModel])

  const hasLoadedTalentTree = useMemo(() => {
    return trees.length > 0
  }, [trees.length])

  const titleContextId = isCreatureModel || isBlueprintModel ? (selectedArchetype?.id ?? '') : 'Player'

  const titleContextLabel = useMemo(() => {
    if (isCreatureModel || isBlueprintModel) {
      return resolveLocalizedValue(
        selectedArchetype?.display,
        localeStrings,
        selectedArchetype?.id || (isBlueprintModel ? 'Tech Tree' : 'Creature')
      )
    }

    return 'Player'
  }, [isBlueprintModel, isCreatureModel, localeStrings, selectedArchetype?.display, selectedArchetype?.id])

  const currentBuildName = useMemo(() => {
    return typeof pendingSharedMetadata?.title === 'string' ? pendingSharedMetadata.title.trim() : ''
  }, [pendingSharedMetadata?.title])

  const matchingSavedBuild = useMemo(() => {
    if (!currentBuildName) {
      return null
    }

    return findDuplicateSavedBuild({
      savedBuilds,
      title: currentBuildName,
      modelId,
      contextId: titleContextId
    })
  }, [currentBuildName, modelId, savedBuilds, titleContextId])

  const hasMeaningfulCurrentBuild = useMemo(() => {
    return hasMeaningfulBuildState({
      modelId,
      archetypeId: selectedArchetype?.id ?? archetypeId,
      skilledTalents,
      selectedPlayerModifierIds: normalizedSelectedPlayerModifierIds,
      models: data?.models
    })
  }, [
    archetypeId,
    data?.models,
    modelId,
    normalizedSelectedPlayerModifierIds,
    selectedArchetype?.id,
    skilledTalents
  ])

  const normalizedCurrentTitleTalents = useMemo(() => {
    if (modelId === 'Creature') {
      return ensureCreatureArchetypeBuild(skilledTalents ?? {}, data?.models?.Creature, titleContextId)
    }

    if (modelId === BLUEPRINT_MODEL_ID) {
      return getScopedArchetypeTalentState(skilledTalents ?? {}, data?.models?.[BLUEPRINT_MODEL_ID], titleContextId)
    }

    return normalizeTalentState(skilledTalents ?? {})
  }, [data?.models, modelId, skilledTalents, titleContextId])

  const showSavedBuildPrefix = Boolean(matchingSavedBuild) && hasMeaningfulCurrentBuild

  const isActiveBuildUnsaved = useMemo(() => {
    if (!showSavedBuildPrefix || !matchingSavedBuild) {
      return false
    }

    const normalizedSavedTalents = modelId === 'Creature'
      ? ensureCreatureArchetypeBuild(matchingSavedBuild.skilledTalents ?? {}, data?.models?.Creature, titleContextId)
      : (modelId === BLUEPRINT_MODEL_ID
        ? getScopedArchetypeTalentState(
          matchingSavedBuild.skilledTalents ?? {},
          data?.models?.[BLUEPRINT_MODEL_ID],
          titleContextId
        )
        : normalizeTalentState(matchingSavedBuild.skilledTalents ?? {}))

    const talentsChanged = !areTalentStatesEqual(normalizedCurrentTitleTalents, normalizedSavedTalents)
    const currentModifierIds = modelId === 'Player'
      ? normalizePlayerModifierIds(normalizedSelectedPlayerModifierIds, data?.playerTalentModifiers)
      : []
    const savedModifierIds = modelId === 'Player'
      ? normalizePlayerModifierIds(matchingSavedBuild.playerModifierIds, data?.playerTalentModifiers)
      : []
    const modifiersChanged = !areStringArraysEqual(currentModifierIds, savedModifierIds)
    const currentDescription = typeof pendingSharedMetadata?.description === 'string'
      ? pendingSharedMetadata.description.trim()
      : ''
    const savedDescription = typeof matchingSavedBuild.description === 'string'
      ? matchingSavedBuild.description.trim()
      : ''

    return talentsChanged || modifiersChanged || currentDescription !== savedDescription
  }, [
    data?.models,
    data?.playerTalentModifiers,
    matchingSavedBuild,
    modelId,
    normalizedSelectedPlayerModifierIds,
    normalizedCurrentTitleTalents,
    pendingSharedMetadata?.description,
    showSavedBuildPrefix,
    titleContextId
  ])

  useEffect(() => {
    const fallbackTitleContextLabel = isCreatureModel
      ? 'Creature'
      : (isBlueprintModel ? 'Tech Tree' : 'Player')
    const baseTitle = `${titleContextLabel || fallbackTitleContextLabel} // Talents // ICARUS`
    if (!showSavedBuildPrefix || !matchingSavedBuild?.title) {
      document.title = baseTitle
      return
    }

    const unsavedMarker = isActiveBuildUnsaved ? '*' : ''
    document.title = `${matchingSavedBuild.title}${unsavedMarker} // ${baseTitle}`
  }, [isActiveBuildUnsaved, isBlueprintModel, isCreatureModel, matchingSavedBuild?.title, showSavedBuildPrefix, titleContextLabel])

  const emptyStateMessage = 'No talents found.'

  const isEffectsSidebarDisabled = !hasLoadedTalentTree

  const effectScopeTreeIds = useMemo(() => {
    if (modelId !== 'Creature' && modelId !== BLUEPRINT_MODEL_ID) {
      return null
    }

    return new Set(Object.values(selectedArchetype?.trees ?? {}).map((tree) => tree.id))
  }, [modelId, selectedArchetype])

  const effectSummary = useMemo(() => {
    const aggregatedMap = new Map()

    Object.entries(skilledTalents ?? {}).forEach(([treeId, treeTalents]) => {
      if (effectScopeTreeIds && !effectScopeTreeIds.has(treeId)) {
        return
      }

      const tree = treeLookup[treeId]
      if (!tree) return

      const isSoloTree = treeArchetypeMap[treeId] === 'Solo'
      if (isSoloTree && !includeSoloEffects) {
        return
      }

      Object.entries(treeTalents ?? {}).forEach(([talentId, rankValue]) => {
        const rank = Number(rankValue)
        if (!Number.isFinite(rank) || rank <= 0) return

        const talent = tree.talents?.[talentId]
        if (!talent?.rewards?.length) return

        const selectedRankIndex = Math.min(rank, talent.rewards.length) - 1
        if (selectedRankIndex < 0) return

        const selectedReward = talent.rewards[selectedRankIndex]
        ;(selectedReward?.effects ?? []).forEach((effect) => {
          const modifierId = extractModifierId(effect)
          if (!modifierId) return

          const numericValue = Number(effect?.value)
          const value = Number.isFinite(numericValue) ? numericValue : 0
          const existing = aggregatedMap.get(modifierId)
          const talentName = resolveLocalizedValue(talent.display, localeStrings, talent.id)

          if (existing) {
            existing.total += value
            existing.occurrences += 1
            existing.talentNames.add(talentName)
            return
          }

          aggregatedMap.set(modifierId, {
            modifierId,
            total: value,
            occurrences: 1,
            talentNames: new Set([talentName])
          })
        })
      })
    })

    const rows = Array.from(aggregatedMap.values()).map((entry) => {
      const template = resolveModifierEffectTemplate(entry.modifierId, entry.total, localeStrings)
      const hasTemplate = Boolean(template)
      const displayText = hasTemplate
        ? interpolateEffectTemplate(template, entry.total)
        : Array.from(entry.talentNames).sort((left, right) => left.localeCompare(right)).join(', ')

      return {
        modifierId: entry.modifierId,
        displayText,
        fallbackValue: hasTemplate ? '' : formatModifierTotal(entry.modifierId, entry.total),
        hasFallbackValue: !hasTemplate
      }
    })

    return rows.sort((left, right) => {
      const localizedSort = left.displayText.localeCompare(right.displayText, undefined, {
        sensitivity: 'base'
      })

      if (localizedSort !== 0) return localizedSort
      return left.modifierId.localeCompare(right.modifierId, undefined, { sensitivity: 'base' })
    })
  }, [effectScopeTreeIds, includeSoloEffects, localeStrings, skilledTalents, treeArchetypeMap, treeLookup])

  const getMinimumLevel = () => {
    const effectiveTalentPoints = Math.max(0, pointsSummary.talentPoints - playerBonusTalentPoints)
    const { soloPoints } = pointsSummary
    let earnedTalentPoints = 0
    let earnedSoloPoints = 0

    for (let level = 1; level <= 60; level += 1) {
      if (level % 2 === 1) {
        earnedTalentPoints += 1
      } else {
        earnedTalentPoints += 2
      }

      if (level % 2 === 0) {
        earnedSoloPoints += 1
      }

      if (earnedTalentPoints >= effectiveTalentPoints && earnedSoloPoints >= soloPoints) {
        return level
      }
    }

    return 60
  }

  const cascadeInvalidTalentsInTree = (treeId, treeTalents) => {
    const tree = treeLookup[treeId]
    if (!tree?.talents) {
      return treeTalents
    }

    const nextTreeTalents = { ...(treeTalents ?? {}) }
    const originTalentId = modelId === 'Creature' ? creatureOriginTalentByTree[treeId] : null

    let didChange = true
    while (didChange) {
      didChange = false
      const treePoints = Object.values(nextTreeTalents).reduce(
        (total, rank) => total + (Number.isFinite(Number(rank)) ? Number(rank) : 0),
        0
      )

      Object.entries(nextTreeTalents).forEach(([candidateTalentId, candidateRank]) => {
        const rank = Number(candidateRank)
        if (!Number.isFinite(rank) || rank <= 0) {
          return
        }

        if (originTalentId && candidateTalentId === originTalentId) {
          return
        }

        const candidateTalent = tree.talents[candidateTalentId]
        if (!candidateTalent) {
          return
        }

        if (shouldHideTalent(candidateTalent)) {
          nextTreeTalents[candidateTalentId] = 0
          didChange = true
          return
        }

        const requiredRank = candidateTalent.requiredRank
        const requiredPoints = requiredRank ? RANK_INVESTMENTS[requiredRank] : 0
        const meetsRankRequirement = !requiredRank || treePoints >= requiredPoints

        const requiredTalents = resolveEffectiveRequiredTalentIds(
          candidateTalent.requiredTalents,
          tree.talents
        )
        const meetsPrerequisites = requiredTalents.length === 0 || requiredTalents.some((requiredTalentId) => {
          return (nextTreeTalents[requiredTalentId] ?? 0) > 0
        })

        if (!meetsRankRequirement || !meetsPrerequisites) {
          nextTreeTalents[candidateTalentId] = 0
          didChange = true
        }
      })
    }

    return nextTreeTalents
  }

  const handleSkillTalent = (treeId, talentId, newRank) => {
    setSkilledTalents((prev) => {
      const previousRank = prev?.[treeId]?.[talentId] ?? 0
      if (newRank === previousRank) return prev

      if (modelId === 'Creature') {
        const originTalentId = creatureOriginTalentByTree[treeId]
        if (originTalentId && talentId === originTalentId && newRank < 1) {
          return prev
        }
      }

      const next = {
        ...prev,
        [treeId]: {
          ...prev[treeId],
          [talentId]: newRank
        }
      }

      if (newRank < previousRank) {
        next[treeId] = cascadeInvalidTalentsInTree(treeId, next[treeId])
      }

      const nextSummary = summarizeTalentPoints(
        next,
        treeArchetypeMap,
        modelId === 'Creature' ? creatureOriginTalentByTree : null
      )
      const isSoloTree = getIsSoloTree(treeId)

      if (modelId === 'Creature') {
        const creatureCap = creatureTreeProgressById[treeId]?.levelCap
        if (Number.isFinite(creatureCap)) {
          const nextTreePoints = getTreeTalentPoints(next[treeId], creatureOriginTalentByTree[treeId])
          if (nextTreePoints > creatureCap) {
            return prev
          }
        }
      }

      if (modelId === 'Player' && !isSoloTree && nextSummary.talentPoints > maxPlayerTalentPoints) {
        return prev
      }

      if (modelId === 'Player' && isSoloTree && nextSummary.soloPoints > MAX_SOLO_POINTS) {
        return prev
      }

      return next
    })
  }

  const handleTogglePlayerModifier = (modifierId) => {
    if (!modifierId) return

    setSelectedPlayerModifierIds((previousIds) => {
      const normalizedPreviousIds = normalizePlayerModifierIds(previousIds, data?.playerTalentModifiers)
      if (normalizedPreviousIds.includes(modifierId)) {
        return normalizedPreviousIds.filter((id) => id !== modifierId)
      }

      return normalizePlayerModifierIds([...normalizedPreviousIds, modifierId], data?.playerTalentModifiers)
    })
  }

  const handleOpenSaveDialog = () => {
    const initialTitle = pendingSharedMetadata?.title || ''
    const initialDescription = pendingSharedMetadata?.description || ''
    const isCreatureBuild = modelId === 'Creature'
    const isBlueprintBuild = modelId === BLUEPRINT_MODEL_ID
    const duplicate = findDuplicateSavedBuild({
      savedBuilds,
      title: initialTitle,
      modelId,
      contextId: isCreatureBuild || isBlueprintBuild ? (selectedArchetype?.id ?? '') : 'Player'
    })

    setSaveDialogTitle(initialTitle)
    setSaveDialogDescription(initialDescription)
    setSaveDuplicateMatch(duplicate)
    setIsSaveDialogOpen(true)
  }

  const handleCancelSaveDialog = () => {
    setIsSaveDialogOpen(false)
    setSaveDialogTitle('')
    setSaveDialogDescription('')
    setSaveDuplicateMatch(null)
  }

  const handleConfirmSaveDialog = (forceOverwrite = false) => {
    const title = saveDialogTitle.trim() || 'Untitled Build'
    const description = saveDialogDescription.trim()
    const isCreatureBuild = modelId === 'Creature'
    const isBlueprintBuild = modelId === BLUEPRINT_MODEL_ID
    const scopedSkilledTalents = isCreatureBuild
      ? ensureCreatureArchetypeBuild(skilledTalents, data?.models?.Creature, selectedArchetype?.id ?? '')
      : (isBlueprintBuild
        ? getScopedArchetypeTalentState(skilledTalents, data?.models?.[BLUEPRINT_MODEL_ID], selectedArchetype?.id ?? '')
        : skilledTalents)
    const contextName = isCreatureBuild || isBlueprintBuild
      ? resolveLocalizedValue(
        selectedArchetype?.display,
        localeStrings,
        selectedArchetype?.id || (isBlueprintBuild ? 'Tech Tree' : 'Creature')
      )
      : 'Player'
    const contextIcon = isCreatureBuild || isBlueprintBuild
      ? (resolveAssetImagePath(selectedArchetype?.icon) || '')
      : ''

    const duplicate = findDuplicateSavedBuild({
      savedBuilds,
      title,
      modelId,
      contextId: isCreatureBuild || isBlueprintBuild ? (selectedArchetype?.id ?? '') : 'Player'
    })

    if (duplicate && !forceOverwrite) {
      setSaveDuplicateMatch(duplicate)
      return
    }

    const savedBuild = {
      id: createSavedBuildId(),
      title,
      description,
      createdAt: Date.now(),
      modelId,
      archetypeId: selectedArchetype?.id ?? '',
      skilledTalents: scopedSkilledTalents,
      playerModifierIds: modelId === 'Player'
        ? normalizePlayerModifierIds(selectedPlayerModifierIds, data?.playerTalentModifiers)
        : [],
      buildType: isCreatureBuild ? 'creature' : (isBlueprintBuild ? 'blueprint' : 'player'),
      contextId: isCreatureBuild || isBlueprintBuild ? (selectedArchetype?.id ?? '') : 'Player',
      contextName,
      contextIcon
    }

    if (duplicate && forceOverwrite) {
      const overwrittenBuild = {
        ...duplicate,
        title,
        description,
        createdAt: Date.now(),
        modelId,
        archetypeId: selectedArchetype?.id ?? '',
        skilledTalents: scopedSkilledTalents,
        playerModifierIds: modelId === 'Player'
          ? normalizePlayerModifierIds(selectedPlayerModifierIds, data?.playerTalentModifiers)
          : [],
        buildType: isCreatureBuild ? 'creature' : (isBlueprintBuild ? 'blueprint' : 'player'),
        contextId: isCreatureBuild || isBlueprintBuild ? (selectedArchetype?.id ?? '') : 'Player',
        contextName,
        contextIcon
      }

      setSavedBuilds((previousBuilds) => [
        overwrittenBuild,
        ...previousBuilds.filter((build) => build.id !== duplicate.id)
      ])
    } else {
      setSavedBuilds((previousBuilds) => [savedBuild, ...previousBuilds])
    }
    setPendingSharedMetadata(normalizeShareMetadata({
      title,
      description
    }))
    setSaveDuplicateMatch(null)
    setIsSaveDialogOpen(false)
    setSaveDialogTitle('')
    setSaveDialogDescription('')
    setSaveState('saved')
  }

  const handleLoadSavedBuild = (savedBuild) => {
    if (!savedBuild || !data?.models) return false

    const savedModelId = data.models[savedBuild.modelId] ? savedBuild.modelId : 'Player'
    const savedModel = data.models[savedModelId]
    const savedArchetypeId = savedBuild.contextId || savedBuild.archetypeId || ''
    const fallbackCreatureArchetypeId = Object.values(savedModel?.archetypes ?? {})[0]?.id ?? ''
    const fallbackBlueprintArchetypeId = Object.values(savedModel?.archetypes ?? {})[0]?.id ?? ''

    const normalizedSkilledTalents = savedModelId === 'Creature'
      ? ensureCreatureArchetypeBuild(
        savedBuild.skilledTalents ?? {},
        savedModel,
        savedModel.archetypes?.[savedArchetypeId] ? savedArchetypeId : fallbackCreatureArchetypeId
      )
      : (savedModelId === BLUEPRINT_MODEL_ID
        ? getScopedArchetypeTalentState(
          savedBuild.skilledTalents ?? {},
          savedModel,
          savedModel.archetypes?.[savedArchetypeId] ? savedArchetypeId : fallbackBlueprintArchetypeId
        )
        : (savedBuild.skilledTalents ?? {}))
    const nextPlayerModifierIds = savedModelId === 'Player'
      ? normalizePlayerModifierIds(savedBuild.playerModifierIds, data?.playerTalentModifiers)
      : []

    setModelId(savedModelId)
    setArchetypeId(savedModelId === 'Creature'
      ? (savedModel.archetypes?.[savedArchetypeId] ? savedArchetypeId : fallbackCreatureArchetypeId)
      : (savedModelId === BLUEPRINT_MODEL_ID
        ? (savedModel.archetypes?.[savedArchetypeId] ? savedArchetypeId : fallbackBlueprintArchetypeId)
        : (savedBuild.archetypeId || ''))
    )
    setSkilledTalents(normalizedSkilledTalents)
    setSelectedPlayerModifierIds(nextPlayerModifierIds)

    const hasOvercap = savedModelId === 'Creature'
      ? hasCreatureOvercap(normalizedSkilledTalents, savedModel)
      : (savedModelId === 'Player' && hasPlayerOvercap(
        normalizedSkilledTalents,
        savedModel,
        getMaxPlayerTalentPoints(nextPlayerModifierIds, data?.playerTalentModifiers)
      ))

    setDecodeBuildError(hasOvercap ? 'overcap' : '')
    setBuildWarnings([])
    setPendingSharedMetadata(normalizeShareMetadata({
      title: savedBuild.title,
      description: savedBuild.description
    }))
    setSaveDuplicateMatch(null)
    setSaveState('idle')
    setResetState('idle')
    setIsSaveDialogOpen(false)

    return true
  }

  const handleDeleteSavedBuild = (savedBuildId) => {
    setSavedBuilds((previousBuilds) => previousBuilds.filter((build) => build.id !== savedBuildId))
    setSavedBuildLoadStateById((previousState) => {
      const { [savedBuildId]: _, ...nextState } = previousState
      return nextState
    })
    setSavedBuildShareStateById((previousState) => {
      const { [savedBuildId]: _, ...nextState } = previousState
      return nextState
    })
    setSavedBuildDeleteStateById((previousState) => {
      const { [savedBuildId]: _, ...nextState } = previousState
      return nextState
    })
  }

  const handleLoadSavedBuildWithFeedback = (savedBuild) => {
    const didLoad = handleLoadSavedBuild(savedBuild)
    if (!didLoad) return

    const savedBuildId = savedBuild.id
    const existingTimeout = savedBuildLoadTimeoutsRef.current[savedBuildId]
    if (existingTimeout) {
      window.clearTimeout(existingTimeout)
    }

    setSavedBuildLoadStateById((previousState) => ({
      ...previousState,
      [savedBuildId]: 'done'
    }))

    savedBuildLoadTimeoutsRef.current[savedBuildId] = window.setTimeout(() => {
      setSavedBuildLoadStateById((previousState) => {
        const { [savedBuildId]: _, ...nextState } = previousState
        return nextState
      })
      delete savedBuildLoadTimeoutsRef.current[savedBuildId]
    }, SAVED_BUILD_ACTION_FEEDBACK_MS)
  }

  const handleToggleDeleteSavedBuild = (savedBuildId) => {
    if (savedBuildDeleteStateById[savedBuildId] === 'pending') {
      const existingTimeout = savedBuildDeleteTimeoutsRef.current[savedBuildId]
      if (existingTimeout) {
        window.clearTimeout(existingTimeout)
        delete savedBuildDeleteTimeoutsRef.current[savedBuildId]
      }

      setSavedBuildDeleteStateById((previousState) => {
        const { [savedBuildId]: _, ...nextState } = previousState
        return nextState
      })
      return
    }

    setSavedBuildDeleteStateById((previousState) => ({
      ...previousState,
      [savedBuildId]: 'pending'
    }))

    savedBuildDeleteTimeoutsRef.current[savedBuildId] = window.setTimeout(() => {
      handleDeleteSavedBuild(savedBuildId)
      delete savedBuildDeleteTimeoutsRef.current[savedBuildId]
    }, SAVED_BUILD_DELETE_ANIMATION_MS)
  }

  const handleSavedBuildTooltipMove = (event, savedBuild, savedTime, savedDescription) => {
    setSavedBuildTooltip({
      left: event.clientX + 14,
      top: event.clientY + 14,
      title: savedBuild.title,
      timestamp: savedTime,
      description: savedDescription || 'No description'
    })
  }

  const handleSavedBuildTooltipLeave = () => {
    setSavedBuildTooltip(null)
  }

  const handleSelectModel = (nextModelId) => {
    if (!nextModelId || nextModelId === modelId) return
    setModelId(nextModelId)

    if (nextModelId === 'Creature') {
      const creatureModel = data?.models?.Creature ?? null
      const fallbackArchetypeId = Object.values(creatureModel?.archetypes ?? {}).find(
        (archetype) => !HIDDEN_CREATURE_ARCHETYPE_IDS.has(archetype.id)
      )?.id ?? ''
      const hasExplicitCreatureSelection = Boolean(
        archetypeId
          && creatureModel?.archetypes?.[archetypeId]
          && !HIDDEN_CREATURE_ARCHETYPE_IDS.has(archetypeId)
      )
      const currentOrFallbackArchetypeId = hasExplicitCreatureSelection
        ? archetypeId
        : fallbackArchetypeId
      const creatureDraft = activeBuildsRef.current?.creatures?.[currentOrFallbackArchetypeId]?.skilledTalents ?? {}
      const normalizedSkilledTalents = ensureCreatureArchetypeBuild(
        creatureDraft,
        creatureModel,
        currentOrFallbackArchetypeId
      )

      setArchetypeId(currentOrFallbackArchetypeId)
      setSkilledTalents(normalizedSkilledTalents)
      setSelectedPlayerModifierIds([])
      setPendingSharedMetadata(getActiveBuildMetadata(activeBuildsRef.current, 'Creature', currentOrFallbackArchetypeId))
      setDecodeBuildError(hasCreatureOvercap(normalizedSkilledTalents, creatureModel) ? 'overcap' : '')
    } else if (nextModelId === BLUEPRINT_MODEL_ID) {
      const blueprintModel = data?.models?.[BLUEPRINT_MODEL_ID] ?? null
      const fallbackArchetypeId = Object.values(blueprintModel?.archetypes ?? {})[0]?.id ?? ''
      const hasExplicitBlueprintSelection = Boolean(archetypeId && blueprintModel?.archetypes?.[archetypeId])
      const currentOrFallbackArchetypeId = hasExplicitBlueprintSelection ? archetypeId : fallbackArchetypeId
      const blueprintDraft = activeBuildsRef.current?.blueprints?.[currentOrFallbackArchetypeId]?.skilledTalents ?? {}
      const normalizedSkilledTalents = getScopedArchetypeTalentState(
        blueprintDraft,
        blueprintModel,
        currentOrFallbackArchetypeId
      )

      setArchetypeId(currentOrFallbackArchetypeId)
      setSkilledTalents(normalizedSkilledTalents)
      setSelectedPlayerModifierIds([])
      setPendingSharedMetadata(getActiveBuildMetadata(activeBuildsRef.current, BLUEPRINT_MODEL_ID, currentOrFallbackArchetypeId))
      setDecodeBuildError('')
    } else {
      const playerDraft = activeBuildsRef.current?.player?.skilledTalents ?? {}
      const playerArchetypeId = activeBuildsRef.current?.player?.archetypeId ?? ''
      const playerModifierIds = normalizePlayerModifierIds(
        activeBuildsRef.current?.player?.modifierIds,
        data?.playerTalentModifiers
      )

      setArchetypeId(playerArchetypeId)
      setSkilledTalents(playerDraft)
      setSelectedPlayerModifierIds(playerModifierIds)
      setPendingSharedMetadata(getActiveBuildMetadata(activeBuildsRef.current, 'Player', playerArchetypeId))
      setDecodeBuildError(
        hasPlayerOvercap(
          playerDraft,
          data?.models?.Player,
          getMaxPlayerTalentPoints(playerModifierIds, data?.playerTalentModifiers)
        )
          ? 'overcap'
          : ''
      )
    }

    setResetState('idle')
    setSaveDuplicateMatch(null)
  }

  const handleShareBuild = async () => {
    const shareBuildPayload = createShareBuildPayload({
      modelId,
      archetypeId: selectedArchetype?.id ?? archetypeId,
      skilledTalents,
      playerModifierIds: selectedPlayerModifierIds,
      playerTalentModifiers: data?.playerTalentModifiers,
      models: data?.models,
      schemaVersion: data?.schemaVersion,
      metadata: pendingSharedMetadata
    })

    const shareUrl = createShareUrlFromPayload(shareBuildPayload)
    if (!shareUrl) {
      setShareState('idle')
      return
    }

    window.history.replaceState({}, '', shareUrl)

    try {
      await window.navigator.clipboard.writeText(shareUrl.toString())
    } catch {
      window.prompt('Copy this build URL', shareUrl.toString())
    }

    setShareState('copied')
  }

  const handleShareSavedBuild = async (savedBuild) => {
    if (!savedBuild || !data?.models) return

    const shareBuildPayload = createShareBuildPayload({
      modelId: savedBuild.modelId,
      archetypeId: savedBuild.contextId || savedBuild.archetypeId || '',
      skilledTalents: savedBuild.skilledTalents ?? {},
      playerModifierIds: savedBuild.playerModifierIds ?? [],
      playerTalentModifiers: data?.playerTalentModifiers,
      models: data.models,
      schemaVersion: data.schemaVersion,
      metadata: {
        title: savedBuild.title,
        description: savedBuild.description || ''
      }
    })

    const shareUrl = createShareUrlFromPayload(shareBuildPayload)
    if (!shareUrl) {
      return
    }

    window.history.replaceState({}, '', shareUrl)

    try {
      await window.navigator.clipboard.writeText(shareUrl.toString())
    } catch {
      window.prompt('Copy this build URL', shareUrl.toString())
    }

    const savedBuildId = savedBuild.id
    const existingTimeout = savedBuildShareTimeoutsRef.current[savedBuildId]
    if (existingTimeout) {
      window.clearTimeout(existingTimeout)
    }

    setSavedBuildShareStateById((previousState) => ({
      ...previousState,
      [savedBuildId]: 'done'
    }))

    savedBuildShareTimeoutsRef.current[savedBuildId] = window.setTimeout(() => {
      setSavedBuildShareStateById((previousState) => {
        const { [savedBuildId]: _, ...nextState } = previousState
        return nextState
      })
      delete savedBuildShareTimeoutsRef.current[savedBuildId]
    }, SAVED_BUILD_ACTION_FEEDBACK_MS)
  }

  const handleSelectArchetype = (nextArchetypeId) => {
    if (!nextArchetypeId || nextArchetypeId === selectedArchetype?.id) return

    if (modelId === BLUEPRINT_MODEL_ID) {
      const blueprintModel = data?.models?.[BLUEPRINT_MODEL_ID] ?? null
      const blueprintDraft = activeBuildsRef.current?.blueprints?.[nextArchetypeId]?.skilledTalents ?? {}
      const normalizedSkilledTalents = getScopedArchetypeTalentState(
        blueprintDraft,
        blueprintModel,
        nextArchetypeId
      )

      setArchetypeId(nextArchetypeId)
      setSkilledTalents(normalizedSkilledTalents)
      setPendingSharedMetadata(getActiveBuildMetadata(activeBuildsRef.current, BLUEPRINT_MODEL_ID, nextArchetypeId))
      setDecodeBuildError('')
      return
    }

    if (modelId !== 'Creature') {
      setArchetypeId(nextArchetypeId)
      return
    }

    const creatureModel = data?.models?.Creature ?? null
    const creatureDraft = activeBuildsRef.current?.creatures?.[nextArchetypeId]?.skilledTalents ?? {}
    const normalizedSkilledTalents = ensureCreatureArchetypeBuild(
      creatureDraft,
      creatureModel,
      nextArchetypeId
    )

    setArchetypeId(nextArchetypeId)
    setSkilledTalents(normalizedSkilledTalents)
    setPendingSharedMetadata(getActiveBuildMetadata(activeBuildsRef.current, 'Creature', nextArchetypeId))
    setDecodeBuildError(hasCreatureOvercap(normalizedSkilledTalents, creatureModel) ? 'overcap' : '')
  }

  const renderArchetypeChip = (item) => {
    const chipIconPath = resolveAssetImagePath(item.icon)

    return (
      <button
        key={item.id}
        className={item.id === selectedArchetype?.id ? 'chip active' : 'chip'}
        onClick={() => handleSelectArchetype(item.id)}
      >
        <span className="chip-content">
          {chipIconPath && (
            <img
              src={chipIconPath}
              alt=""
              className="chip-icon"
              onError={(event) => {
                event.target.style.display = 'none'
              }}
            />
          )}
          <span>{resolveLocalizedValue(item.display, localeStrings, item.id)}</span>
        </span>
      </button>
    )
  }

  const handleResetBuild = () => {
    if (!hasSpentPoints) return

    setIsResetConfirmOpen(true)
  }

  const handleCancelReset = () => {
    setIsResetConfirmOpen(false)
  }

  const handleConfirmReset = () => {
    if (!hasSpentPoints) {
      setIsResetConfirmOpen(false)
      return
    }

    setSkilledTalents(
      modelId === 'Creature'
        ? ensureCreatureArchetypeBuild({}, selectedModel, selectedArchetype?.id ?? '')
        : {}
    )
    setDecodeBuildError('')
    setBuildWarnings([])
    setPendingSharedMetadata(null)
    setSaveDuplicateMatch(null)
    setResetState('done')
    setIsResetConfirmOpen(false)
  }

  useEffect(() => {
    if (!selectedArchetype) return
    setArchetypeId(selectedArchetype.id)
  }, [selectedArchetype])

  useEffect(() => {
    if (modelId !== 'Creature') return

    setSkilledTalents((previousState) => {
      return ensureCreatureArchetypeBuild(previousState, selectedModel, selectedArchetype?.id ?? '')
    })
  }, [modelId, selectedArchetype?.id, selectedModel])

  useEffect(() => {
    if (!isCreatureModel) return

    const selectedCategory = getCreatureArchetypeCategory(selectedArchetype, creatureTreeProgressById)
    if (selectedCategory && selectedCategory !== selectedCreatureMetaGroupId) {
      setSelectedCreatureMetaGroupId(selectedCategory)
    }
  }, [creatureTreeProgressById, isCreatureModel, selectedArchetype, selectedCreatureMetaGroupId])

  useEffect(() => {
    if (decodeBuildError !== 'overcap') return
    const stillOvercap = modelId === 'Creature'
      ? hasCreatureOvercap(skilledTalents, selectedModel)
      : (modelId === 'Player' && (
        pointsSummary.talentPoints > maxPlayerTalentPoints
        || pointsSummary.soloPoints > MAX_SOLO_POINTS
      ))

    if (!stillOvercap) {
      setDecodeBuildError('')
    }
  }, [decodeBuildError, maxPlayerTalentPoints, modelId, pointsSummary, selectedModel, skilledTalents])

  useEffect(() => {
    if (saveState === 'idle') return
    const timeoutId = window.setTimeout(() => {
      setSaveState('idle')
    }, 1800)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [saveState])

  useEffect(() => {
    if (shareState === 'idle') return
    const timeoutId = window.setTimeout(() => {
      setShareState('idle')
    }, 1800)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [shareState])

  useEffect(() => {
    if (resetState === 'idle') return
    const timeoutId = window.setTimeout(() => {
      setResetState('idle')
    }, 1800)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [resetState])

  useEffect(() => {
    if (!isResetConfirmOpen && !isSaveDialogOpen && !isDisclaimerDialogOpen) return

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsResetConfirmOpen(false)
        setIsSaveDialogOpen(false)
        setIsDisclaimerDialogOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isDisclaimerDialogOpen, isResetConfirmOpen, isSaveDialogOpen])

  useEffect(() => {
    const loadTimeouts = savedBuildLoadTimeoutsRef.current
    const shareTimeouts = savedBuildShareTimeoutsRef.current
    const deleteTimeouts = savedBuildDeleteTimeoutsRef.current

    return () => {
      Object.values(loadTimeouts).forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
      Object.values(shareTimeouts).forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
      Object.values(deleteTimeouts).forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
    }
  }, [])

  const projectVersionLabel = data?.projectVersion || '—'
  const calculatorVersionLabel = import.meta.env.VITE_CALCULATOR_VERSION || '—'

  if (!data) {
    return (
      <div className="app">
        <header className="top-nav">
          <div className="top-nav-left">
            <BrandName />
            <nav className="top-menu" aria-label="Model navigation">
              <button type="button" className="menu-link active">
                <MenuItemLabel iconPath={topMenuIcons.Player} label="Player" />
              </button>
              <button
                type="button"
                className={modelId === BLUEPRINT_MODEL_ID ? 'menu-link active' : 'menu-link'}
                onClick={() => handleSelectModel(BLUEPRINT_MODEL_ID)}
              >
                <MenuItemLabel iconPath={topMenuIcons.TechTree} label="Tech Tree" />
              </button>
              <button type="button" className="menu-link" disabled title="Coming sooon…">
                <MenuItemLabel iconPath={topMenuIcons.Workshop} label="Workshop" />
              </button>
            </nav>
          </div>

          <div className="top-nav-right">
            <LocaleDropdown
              locales={availableLocales}
              selectedLocale={locale}
              onSelectLocale={setLocale}
            />
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="top-nav-github-link"
              aria-label="Open GitHub repository"
              title="GitHub"
            >
              <Github className="top-nav-github-icon" aria-hidden="true" />
            </a>
          </div>
        </header>

        <footer className="app-footer" role="contentinfo">
          <div className="footer-build-meta">
            Version: {calculatorVersionLabel} ({projectVersionLabel})
          </div>
          <button
            type="button"
            className="footer-disclaimer-link"
            onClick={() => setIsDisclaimerDialogOpen(true)}
          >
            ICARUS and related materials are trademarks and copyrighted works of <strong>RocketWerkz</strong>. All rights reserved. This site is not affiliated with or endorsed by <strong>RocketWerkz</strong>.
          </button>
        </footer>

        {isDisclaimerDialogOpen && (
          <div className="confirm-overlay" role="presentation" onClick={() => setIsDisclaimerDialogOpen(false)}>
            <div
              className="confirm-dialog legal-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="legal-disclaimer-title"
              aria-describedby="legal-disclaimer-body"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="legal-disclaimer-title" className="confirm-title">Legal Disclaimer</h2>
              <p id="legal-disclaimer-body" className="confirm-body legal-disclaimer-body">
                The files on this Wiki comes from
                {' '}
                <a href={ICARUS_STEAM_URL} target="_blank" rel="noreferrer"><strong>ICARUS</strong></a>
                {' '}
                (data files or gameplay), from websites, or from any other content created and owned by
                {' '}
                <a href={ROCKETWERKZ_URL} target="_blank" rel="noreferrer"><strong>RocketWerkz</strong></a>
                , who hold the copyright of
                {' '}
                <a href={ICARUS_STEAM_URL} target="_blank" rel="noreferrer"><strong>ICARUS</strong></a>
                . Unless specified otherwise, all trademarks and registered trademarks present in this Wiki and all sub-pages are proprietary to
                {' '}
                <a href={ROCKETWERKZ_URL} target="_blank" rel="noreferrer"><strong>RocketWerkz</strong></a>
                . The use of images to illustrate articles concerning the subject of the images in question is believed to qualify as fair use under United States copyright law, as such display does not significantly impede the right of the copyright holder to sell the copyrighted material.
              </p>
              <div className="confirm-actions">
                <button type="button" className="confirm-button" onClick={() => setIsDisclaimerDialogOpen(false)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="top-nav">
        <div className="top-nav-left">
          <BrandName />
          <nav className="top-menu" aria-label="Model navigation">
            {models.map((model) => (
              <button
                key={model.id}
                type="button"
                className={model.id === modelId ? 'menu-link active' : 'menu-link'}
                onClick={() => handleSelectModel(model.id)}
              >
                <MenuItemLabel
                  iconPath={topMenuIcons[model.id] || ''}
                  label={resolveLocalizedValue(model.display, localeStrings, model.id)}
                />
              </button>
            ))}
            <button
              type="button"
              className={modelId === BLUEPRINT_MODEL_ID ? 'menu-link active' : 'menu-link'}
              onClick={() => handleSelectModel(BLUEPRINT_MODEL_ID)}
            >
              <MenuItemLabel iconPath={topMenuIcons.TechTree} label="Tech Tree" />
            </button>
            <button type="button" className="menu-link" disabled title="Coming sooon…">
              <MenuItemLabel iconPath={topMenuIcons.Workshop} label="Workshop" />
            </button>
          </nav>
        </div>

        <div className="top-nav-right">
          <LocaleDropdown
            locales={availableLocales}
            selectedLocale={locale}
            onSelectLocale={setLocale}
          />
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="top-nav-github-link"
            aria-label="View on GitHub"
            title="View on GitHub"
          >
            <Github className="top-nav-github-icon" aria-hidden="true" />
          </a>
        </div>
      </header>

      <div className="app-content">
        {decodeBuildError && (
          <div className="error-banner">
            {getHumanErrorMessage(decodeBuildError)}
          </div>
        )}

        {buildWarnings.map((warningMessage) => (
          <div key={warningMessage} className="error-banner">
            {warningMessage}
          </div>
        ))}

        <section className="subcategory-tabs" aria-label="Subcategories">
          {isCreatureModel ? (
            <div className="creature-tabs" aria-label="Creature type tabs">
              <div className="creature-meta-pills" aria-label="Creature groups">
                {CREATURE_TAB_GROUPS.map((group) => {
                  const groupedArchetypes = creatureArchetypesByCategory[group.id] ?? []
                  if (groupedArchetypes.length === 0) {
                    return null
                  }

                  const options = groupedArchetypes.map((item) => ({
                    id: item.id,
                    label: resolveLocalizedValue(item.display, localeStrings, item.id),
                    iconPath: resolveAssetImagePath(item.icon) || ''
                  }))
                  const selectedArchetypeInGroup = groupedArchetypes.find((item) => item.id === selectedArchetype?.id)
                  const selectedArchetypeIdInGroup = selectedArchetypeInGroup?.id ?? ''
                  const isActiveGroup = selectedCreatureMetaGroupId === group.id || Boolean(selectedArchetypeInGroup)
                  const groupIconPath = resolveAssetImagePath(group.icon)

                  return (
                    <CreatureArchetypeDropdown
                      key={group.id}
                      groupId={group.id}
                      groupLabel={group.label}
                      groupIconPath={groupIconPath}
                      options={options}
                      selectedOptionId={selectedArchetypeIdInGroup}
                      isActive={isActiveGroup}
                      onSelectOption={(nextArchetypeId) => {
                        if (!nextArchetypeId) return
                        setSelectedCreatureMetaGroupId(group.id)
                        handleSelectArchetype(nextArchetypeId)
                      }}
                    />
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="chips">
              {archetypes.map((item) => renderArchetypeChip(item))}
            </div>
          )}
          <div className="summary-inline" role="status" aria-label="Build summary">
              {isCreatureModel ? (
                <>
                  <div className="summary-inline-item">
                    <span className="summary-inline-label">Points</span>
                    <span className="summary-inline-value">{selectedCreatureProgress.points}/{selectedCreatureProgress.levelCap}</span>
                  </div>
                  <div className="summary-inline-item">
                    <span className="summary-inline-label">Min Level</span>
                    <span className="summary-inline-value">{selectedCreatureProgress.points}/{selectedCreatureProgress.levelCap}</span>
                  </div>
                </>
              ) : isBlueprintModel ? (
                <>
                  <div className="summary-inline-item">
                    <span className="summary-inline-label">Points</span>
                    <span className="summary-inline-value">{pointsSummary.talentPoints}</span>
                  </div>
                  <div className="summary-inline-item">
                    <span className="summary-inline-label">Unlocked</span>
                    <span className="summary-inline-value">{Object.values(skilledTalents ?? {}).reduce((sum, treeTalents) => {
                      return sum + Object.values(treeTalents ?? {}).filter((rank) => Number(rank) > 0).length
                    }, 0)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="summary-inline-item">
                    <span className="summary-inline-label">Talent</span>
                    <span className="summary-inline-value">{pointsSummary.talentPoints}/{maxPlayerTalentPoints}</span>
                  </div>
                  <div className="summary-inline-item">
                    <span className="summary-inline-label">Solo</span>
                    <span className="summary-inline-value">{pointsSummary.soloPoints}/{MAX_SOLO_POINTS}</span>
                  </div>
                  <div className="summary-inline-item">
                    <span className="summary-inline-label">Min Level</span>
                    <span className="summary-inline-value">{getMinimumLevel()}</span>
                  </div>
                </>
              )}
              <div className="summary-inline-actions" aria-label="Build actions">
                <button
                  type="button"
                  className={shareState === 'copied' ? 'summary-inline-button copied' : 'summary-inline-button'}
                  onClick={handleShareBuild}
                  aria-label={shareState === 'copied' ? 'Build URL copied' : 'Share build'}
                  title={shareState === 'copied' ? 'Copied' : 'Share build URL'}
                >
                  {shareState === 'copied' ? (
                    <Check className="summary-inline-icon" aria-hidden="true" />
                  ) : (
                    <Share2 className="summary-inline-icon" aria-hidden="true" />
                  )}
                  <span>Share</span>
                </button>
                <button
                  type="button"
                  className={saveState === 'saved' ? 'summary-inline-button copied' : 'summary-inline-button'}
                  onClick={handleOpenSaveDialog}
                  aria-label={saveState === 'saved' ? 'Build saved' : 'Save build'}
                  title={saveState === 'saved' ? 'Saved' : 'Save build'}
                >
                  {saveState === 'saved' ? (
                    <Check className="summary-inline-icon" aria-hidden="true" />
                  ) : (
                    <Save className="summary-inline-icon" aria-hidden="true" />
                  )}
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  className={resetState === 'done' ? 'summary-inline-button danger reset-done' : 'summary-inline-button danger'}
                  onClick={handleResetBuild}
                  disabled={!hasSpentPoints}
                  aria-label={resetState === 'done' ? 'Build reset' : 'Reset build'}
                  title={resetState === 'done' ? 'Reset complete' : 'Reset build'}
                >
                  {resetState === 'done' ? (
                    <Check className="summary-inline-icon" aria-hidden="true" />
                  ) : (
                    <Trash2 className="summary-inline-icon" aria-hidden="true" />
                  )}
                  <span>Reset</span>
                </button>
              </div>
            </div>
        </section>

        <div className="content-main">
          <aside className={`saved-builds-sidebar ${isSavedBuildsSidebarCollapsed ? 'collapsed' : ''}`} aria-label="Saved builds">
            {!isSavedBuildsSidebarCollapsed && (
              <div className="saved-builds-sidebar-content">
                <h2 className="saved-builds-title">Saved Builds</h2>
                <div className="saved-builds-list">
                  {savedBuilds.length > 0 ? (
                    savedBuilds.map((savedBuild) => {
                      const savedTime = formatSavedBuildTimestamp(savedBuild.createdAt)
                      const savedDescription = savedBuild.description || ''
                      const savedBuildContext = resolveSavedBuildContext(savedBuild, data, localeStrings)
                      const savedBuildLoadState = savedBuildLoadStateById[savedBuild.id] || 'idle'
                      const savedBuildShareState = savedBuildShareStateById[savedBuild.id] || 'idle'
                      const savedBuildDeleteState = savedBuildDeleteStateById[savedBuild.id] || 'idle'

                      return (
                        <article
                          key={savedBuild.id}
                          className={savedBuildDeleteState === 'pending' ? 'saved-build-item delete-pending' : 'saved-build-item'}
                          onMouseEnter={(event) => {
                            handleSavedBuildTooltipMove(event, savedBuild, savedTime, savedDescription)
                          }}
                          onMouseMove={(event) => {
                            handleSavedBuildTooltipMove(event, savedBuild, savedTime, savedDescription)
                          }}
                          onMouseLeave={handleSavedBuildTooltipLeave}
                        >
                          <div className="saved-build-header">
                            <div className="saved-build-title-group">
                              <span className="saved-build-context" title={savedBuildContext.name}>
                                {savedBuildContext.icon ? (
                                  <img
                                    src={savedBuildContext.icon}
                                    alt=""
                                    className="saved-build-context-icon"
                                    onError={(event) => {
                                      event.target.style.display = 'none'
                                    }}
                                  />
                                ) : null}
                                <span className="saved-build-context-name">{savedBuildContext.name}</span>
                              </span>
                              <span className="saved-build-title">{savedBuild.title}</span>
                            </div>
                            <div className="saved-build-actions">
                              <button
                                type="button"
                                className={savedBuildLoadState === 'done' ? 'saved-build-button copied' : 'saved-build-button'}
                                onClick={() => handleLoadSavedBuildWithFeedback(savedBuild)}
                                aria-label={savedBuildLoadState === 'done' ? `Loaded ${savedBuild.title}` : `Load ${savedBuild.title}`}
                                title={savedBuildLoadState === 'done' ? 'Loaded' : `Load ${savedBuild.title}`}
                              >
                                {savedBuildLoadState === 'done' ? (
                                  <Check className="saved-build-button-icon" aria-hidden="true" />
                                ) : (
                                  <FolderOpen className="saved-build-button-icon" aria-hidden="true" />
                                )}
                              </button>
                              <button
                                type="button"
                                className={savedBuildShareState === 'done' ? 'saved-build-button copied' : 'saved-build-button'}
                                onClick={() => handleShareSavedBuild(savedBuild)}
                                aria-label={savedBuildShareState === 'done' ? `Copied ${savedBuild.title}` : `Share ${savedBuild.title}`}
                                title={savedBuildShareState === 'done' ? 'Copied' : `Share ${savedBuild.title}`}
                              >
                                {savedBuildShareState === 'done' ? (
                                  <Check className="saved-build-button-icon" aria-hidden="true" />
                                ) : (
                                  <Share2 className="saved-build-button-icon" aria-hidden="true" />
                                )}
                              </button>
                              <button
                                type="button"
                                className={savedBuildDeleteState === 'pending' ? 'saved-build-button danger reset-done' : 'saved-build-button danger'}
                                onClick={() => handleToggleDeleteSavedBuild(savedBuild.id)}
                                aria-label={savedBuildDeleteState === 'pending' ? `Cancel delete ${savedBuild.title}` : `Delete ${savedBuild.title}`}
                                title={savedBuildDeleteState === 'pending' ? 'Click again to cancel delete' : `Delete ${savedBuild.title}`}
                              >
                                {savedBuildDeleteState === 'pending' ? (
                                  <Check className="saved-build-button-icon" aria-hidden="true" />
                                ) : (
                                  <Trash2 className="saved-build-button-icon" aria-hidden="true" />
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="saved-build-description">
                            {savedDescription || 'No description'}
                          </div>
                        </article>
                      )
                    })
                  ) : (
                    <div className="saved-builds-empty">No saved builds yet.</div>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              className="saved-builds-sidebar-toggle"
              onClick={() => setIsSavedBuildsSidebarCollapsed((previous) => !previous)}
              aria-expanded={!isSavedBuildsSidebarCollapsed}
              aria-label={isSavedBuildsSidebarCollapsed ? 'Expand saved builds sidebar' : 'Collapse saved builds sidebar'}
              title={isSavedBuildsSidebarCollapsed ? 'Expand saved builds sidebar' : 'Collapse saved builds sidebar'}
            >
              {isSavedBuildsSidebarCollapsed ? (
                <ChevronRight className="saved-builds-sidebar-toggle-icon" aria-hidden="true" />
              ) : (
                <ChevronLeft className="saved-builds-sidebar-toggle-icon" aria-hidden="true" />
              )}
            </button>
          </aside>

          {savedBuildTooltip && (
            <div
              className="saved-build-tooltip"
              role="tooltip"
              style={{ left: `${savedBuildTooltip.left}px`, top: `${savedBuildTooltip.top}px` }}
            >
              <div className="saved-build-tooltip-header">
                <span className="saved-build-tooltip-title">{savedBuildTooltip.title}</span>
                <span className="saved-build-tooltip-time">{savedBuildTooltip.timestamp}</span>
              </div>
              <div className="saved-build-tooltip-description">{savedBuildTooltip.description}</div>
            </div>
          )}

          {hasLoadedTalentTree ? (
            <section className="trees-container">
              {trees.map((tree) => {
                const treePoints = getTreePoints(tree.id)
                const treeSkilledTalents = skilledTalents[tree.id] ?? {}
                return (
                  <div key={tree.id} className="tree-wrapper">
                    <TalentTreeCanvas
                      tree={tree}
                      ranks={data?.ranks}
                      modelId={modelId}
                      localeStrings={localeStrings}
                      skillInvestments={RANK_INVESTMENTS}
                      skilledTalents={treeSkilledTalents}
                      onSkillTalent={(talentId, newRank) => handleSkillTalent(tree.id, talentId, newRank)}
                      treePoints={treePoints}
                    />
                  </div>
                )
              })}
            </section>
          ) : (
            <section className="empty-state">{emptyStateMessage}</section>
          )}

          <aside className={`effects-sidebar ${isEffectsSidebarCollapsed ? 'collapsed' : ''} ${isEffectsSidebarDisabled ? 'disabled' : ''}`}>
            <button
              type="button"
              className="effects-sidebar-toggle"
              onClick={() => setIsEffectsSidebarCollapsed((previous) => !previous)}
              disabled={isEffectsSidebarDisabled}
              aria-expanded={!isEffectsSidebarCollapsed}
              aria-disabled={isEffectsSidebarDisabled}
              aria-label={isEffectsSidebarCollapsed ? 'Expand effects sidebar' : 'Collapse effects sidebar'}
              title={isEffectsSidebarCollapsed ? 'Expand effects sidebar' : 'Collapse effects sidebar'}
            >
              {isEffectsSidebarCollapsed ? (
                <ChevronLeft className="effects-sidebar-toggle-icon" aria-hidden="true" />
              ) : (
                <ChevronRight className="effects-sidebar-toggle-icon" aria-hidden="true" />
              )}
            </button>

            {!isEffectsSidebarCollapsed && (
              <div className="effects-sidebar-content">
                {isEffectsSidebarDisabled ? (
                  <div className="effects-disabled-message">Load a talent tree to view effects.</div>
                ) : (
                  <>
                    {modelId === 'Player' && data?.playerTalentModifiers?.length > 0 && (
                      <div className="modifiers-section">
                        <div className="modifiers-title-row">
                          <h2 className="effects-sidebar-title">Modifiers</h2>
                        </div>
                        <div className="modifiers-list" role="group" aria-label="Talent point modifiers">
                          {data.playerTalentModifiers.map((modifier) => {
                            const isSelected = normalizedSelectedPlayerModifierIds.includes(modifier.id)
                            return (
                              <label key={modifier.id} className="effects-solo-filter modifiers-toggle">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleTogglePlayerModifier(modifier.id)}
                                />
                                <span className="effects-solo-toggle" aria-hidden="true" />
                                <span className="effects-solo-label">{resolveModifierLabel(modifier.id, modifierLabels)}</span>
                                <span className="modifiers-points">+{modifier.talentPointModifier}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className={`effects-sidebar-toprow ${modelId === 'Player' && data?.playerTalentModifiers?.length > 0 ? 'with-modifiers' : ''}`}>
                      <h2 className="effects-sidebar-title">Effects</h2>
                      {modelId === 'Creature' || modelId === BLUEPRINT_MODEL_ID ? (
                        <div className="effects-context-label" title={selectedArchetype?.id || ''}>
                          {resolveLocalizedValue(
                            selectedArchetype?.display,
                            localeStrings,
                            selectedArchetype?.id || (modelId === BLUEPRINT_MODEL_ID ? 'Tech Tree' : 'Creature')
                          )}
                        </div>
                      ) : (
                        <label className="effects-solo-filter">
                          <input
                            type="checkbox"
                            checked={includeSoloEffects}
                            onChange={(event) => setIncludeSoloEffects(event.target.checked)}
                          />
                          <span className="effects-solo-toggle" aria-hidden="true" />
                          <span className="effects-solo-label">SOLO</span>
                        </label>
                      )}
                    </div>

                    <EffectsSummarySection rows={effectSummary} />
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>

      <footer className="app-footer" role="contentinfo">
        <div className="footer-build-meta">Version: {calculatorVersionLabel} ({projectVersionLabel})
        </div>
        <button
          type="button"
          className="footer-disclaimer-link"
          onClick={() => setIsDisclaimerDialogOpen(true)}
        >
          ICARUS and related materials are trademarks and copyrighted works of <strong>RocketWerkz</strong>. All rights reserved. This site is not affiliated with or endorsed by <strong>RocketWerkz</strong>.
        </button>
      </footer>

      {isDisclaimerDialogOpen && (
        <div className="confirm-overlay" role="presentation" onClick={() => setIsDisclaimerDialogOpen(false)}>
          <div
            className="confirm-dialog legal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-disclaimer-title"
            aria-describedby="legal-disclaimer-body"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="legal-disclaimer-title" className="confirm-title">Legal Disclaimer</h2>
            <p id="legal-disclaimer-body" className="confirm-body legal-disclaimer-body">
              The files on this Wiki comes from
              {' '}
              <a href={ICARUS_STEAM_URL} target="_blank" rel="noreferrer"><strong>ICARUS</strong></a>
              {' '}
              (data files or gameplay), from websites, or from any other content created and owned by
              {' '}
              <a href={ROCKETWERKZ_URL} target="_blank" rel="noreferrer"><strong>RocketWerkz</strong></a>
              , who hold the copyright of
              {' '}
              <a href={ICARUS_STEAM_URL} target="_blank" rel="noreferrer"><strong>ICARUS</strong></a>
              . Unless specified otherwise, all trademarks and registered trademarks present in this Wiki and all sub-pages are proprietary to
              {' '}
              <a href={ROCKETWERKZ_URL} target="_blank" rel="noreferrer"><strong>RocketWerkz</strong></a>
              . The use of images to illustrate articles concerning the subject of the images in question is believed to qualify as fair use under United States copyright law, as such display does not significantly impede the right of the copyright holder to sell the copyrighted material.
            </p>
            <div className="confirm-actions">
              <button type="button" className="confirm-button" onClick={() => setIsDisclaimerDialogOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {isResetConfirmOpen && (
        <div className="confirm-overlay" role="presentation" onClick={handleCancelReset}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-confirm-title"
            aria-describedby="reset-confirm-body"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="reset-confirm-title" className="confirm-title">Reset build?</h2>
            <p id="reset-confirm-body" className="confirm-body">
              This will remove all spent points from the current build.
            </p>
            <div className="confirm-actions">
              <button type="button" className="confirm-button" onClick={handleCancelReset}>Cancel</button>
              <button type="button" className="confirm-button danger" onClick={handleConfirmReset}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {isSaveDialogOpen && (
        <div className="confirm-overlay" role="presentation" onClick={handleCancelSaveDialog}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-dialog-title"
            aria-describedby="save-dialog-body"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="save-dialog-title" className="confirm-title">Save build</h2>
            <p id="save-dialog-body" className="confirm-body">
              Add a title and optional description for this build.
            </p>
            {saveDuplicateMatch && (
              <p className="confirm-body save-dialog-warning" role="alert">
                A build named "{saveDuplicateMatch.title}" already exists for "{saveDuplicateMatch.contextName || (saveDuplicateMatch.modelId === 'Creature' ? 'this creature' : (saveDuplicateMatch.modelId === BLUEPRINT_MODEL_ID ? 'this tech tier' : 'Player'))}". Overwrite it?
              </p>
            )}
            <form
              className="save-dialog-form"
              onSubmit={(event) => {
                event.preventDefault()
                handleConfirmSaveDialog(Boolean(saveDuplicateMatch))
              }}
            >
              <label className="save-dialog-label" htmlFor="save-build-title">Title</label>
              <input
                id="save-build-title"
                className="save-dialog-input"
                type="text"
                maxLength={80}
                value={saveDialogTitle}
                onChange={(event) => {
                  const nextTitle = event.target.value
                  const isCreatureBuild = modelId === 'Creature'
                  const duplicate = findDuplicateSavedBuild({
                    savedBuilds,
                    title: nextTitle,
                    modelId,
                    contextId: isCreatureBuild ? (selectedArchetype?.id ?? '') : 'Player'
                  })

                  setSaveDialogTitle(nextTitle)
                  setSaveDuplicateMatch(duplicate)
                }}
                placeholder="Untitled Build"
                autoFocus
              />

              <label className="save-dialog-label" htmlFor="save-build-description">Description (optional)</label>
              <textarea
                id="save-build-description"
                className="save-dialog-textarea"
                maxLength={240}
                value={saveDialogDescription}
                onChange={(event) => setSaveDialogDescription(event.target.value)}
                placeholder="What is this build for?"
                rows={3}
              />

              <div className="confirm-actions">
                <button type="button" className="confirm-button" onClick={handleCancelSaveDialog}>Cancel</button>
                <button type="submit" className="confirm-button danger">{saveDuplicateMatch ? 'Overwrite Existing' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function resolveLocalizedValue(value, localeStrings, fallbackText = '') {
  if (typeof value === 'string') {
    const parsed = parseNsLoc(value)
    if (!parsed) {
      return value || fallbackText
    }

    const scopedKey = `${parsed.category}:${parsed.key}`
    return localeStrings?.[scopedKey] || localeStrings?.[parsed.key] || parsed.text || fallbackText
  }

  if (!value || typeof value !== 'object') {
    return fallbackText
  }

  const scopedKey = value.category && value.key
    ? `${value.category}:${value.key}`
    : null

  return (
    (scopedKey && localeStrings?.[scopedKey])
    || (value.key && localeStrings?.[value.key])
    || value.text
    || fallbackText
  )
}

function summarizeTalentPoints(talentState, treeArchetypeMap, excludedTalentByTree) {
  let talentPoints = 0
  let soloPoints = 0

  Object.entries(talentState ?? {}).forEach(([treeId, talents]) => {
    const isSolo = treeArchetypeMap?.[treeId] === 'Solo'
    const treePoints = getTreeTalentPoints(talents, excludedTalentByTree?.[treeId])

    if (isSolo) {
      soloPoints += treePoints
    } else {
      talentPoints += treePoints
    }
  })

  return { talentPoints, soloPoints }
}

function getTreeTalentPoints(treeTalents, excludedTalentId) {
  return Object.entries(treeTalents ?? {}).reduce((total, [talentId, rankValue]) => {
    if (excludedTalentId && talentId === excludedTalentId) {
      return total
    }

    const rank = Number(rankValue)
    if (!Number.isFinite(rank)) {
      return total
    }

    return total + rank
  }, 0)
}

function getCreatureTreeProgressById(model) {
  const byTreeId = {}

  if (!model || model.id !== 'Creature') {
    return byTreeId
  }

  Object.values(model.archetypes ?? {}).forEach((archetype) => {
    Object.values(archetype.trees ?? {}).forEach((tree) => {
      const talentIds = Object.keys(tree.talents ?? {})
      const hasCombatPetTalentPrefix = talentIds.some((talentId) => talentId.startsWith('CombatPet_'))
      const hasRegularPetTalentPrefix = talentIds.some((talentId) => talentId.startsWith('NonCombatPet_'))

      let category = hasRegularPetTalentPrefix
        ? 'regularPet'
        : (hasCombatPetTalentPrefix ? 'combatPet' : 'mount')

      // Creatures added by Homestead patch use talent naming that can misclassify them as combat pets.
      if (tree.id === 'Creature_Bull' || tree.id === 'Creature_Pig') {
        category = 'regularPet'
      }
      
      const levelCap = category === 'mount' ? CREATURE_MOUNT_LEVEL_CAP : CREATURE_PET_LEVEL_CAP

      byTreeId[tree.id] = {
        category,
        levelCap
      }
    })
  })

  return byTreeId
}

function groupCreatureArchetypesByCategory(archetypes, creatureTreeProgressById) {
  const grouped = {
    mount: [],
    combatPet: [],
    regularPet: []
  }

  archetypes.forEach((archetype) => {
    const firstTree = Object.values(archetype.trees ?? {})[0]
    const inferredCategory = creatureTreeProgressById?.[firstTree?.id]?.category
    const category = inferredCategory && grouped[inferredCategory] ? inferredCategory : 'mount'
    grouped[category].push(archetype)
  })

  return grouped
}

function getCreatureArchetypeCategory(archetype, creatureTreeProgressById) {
  if (!archetype) {
    return 'mount'
  }

  const firstTree = Object.values(archetype.trees ?? {})[0]
  const inferredCategory = creatureTreeProgressById?.[firstTree?.id]?.category
  return inferredCategory || 'mount'
}

function getCreatureOriginTalentByTree(model) {
  const byTreeId = {}

  if (!model || model.id !== 'Creature') {
    return byTreeId
  }

  Object.values(model.archetypes ?? {}).forEach((archetype) => {
    Object.values(archetype.trees ?? {}).forEach((tree) => {
      const talents = Object.values(tree.talents ?? {}).filter((talent) => !shouldHideTalent(talent))
      if (talents.length === 0) {
        return
      }

      const noPrerequisiteTalents = talents.filter(
        (talent) => !Array.isArray(talent.requiredTalents) || talent.requiredTalents.length === 0
      )

      const defaultUnlockedRoot = noPrerequisiteTalents.find(
        (talent) => talent.defaultUnlocked && (talent.rewards?.length ?? 1) === 1
      )
      const fallbackRoot = noPrerequisiteTalents[0] ?? talents[0]
      const rootTalent = defaultUnlockedRoot ?? fallbackRoot

      if (rootTalent?.id) {
        byTreeId[tree.id] = rootTalent.id
      }
    })
  })

  return byTreeId
}

function hasCreatureOvercap(talentState, creatureModel) {
  const creatureProgressByTree = getCreatureTreeProgressById(creatureModel)
  const creatureOriginByTree = getCreatureOriginTalentByTree(creatureModel)

  return Object.entries(talentState ?? {}).some(([treeId, treeTalents]) => {
    const cap = creatureProgressByTree[treeId]?.levelCap
    if (!Number.isFinite(cap)) {
      return false
    }

    const points = getTreeTalentPoints(treeTalents, creatureOriginByTree[treeId])
    return points > cap
  })
}

function hasPlayerOvercap(talentState, model, maxTalentPoints = MAX_TALENT_POINTS) {
  const treeArchetypeMap = getTreeArchetypeMap(model)
  const pointsSummary = summarizeTalentPoints(talentState, treeArchetypeMap)

  return pointsSummary.talentPoints > maxTalentPoints || pointsSummary.soloPoints > MAX_SOLO_POINTS
}

function getTreeArchetypeMap(model) {
  const map = {}

  Object.values(model?.archetypes ?? {}).forEach((archetype) => {
    Object.values(archetype.trees ?? {}).forEach((tree) => {
      map[tree.id] = archetype.id
    })
  })

  return map
}

function createSavedBuildId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `build-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createShareBuildPayload({
  modelId,
  archetypeId,
  skilledTalents,
  playerModifierIds,
  playerTalentModifiers,
  models,
  schemaVersion,
  metadata
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

function createShareUrlFromPayload(payload) {
  const encodedPayload = encodeSharedBuildPayload(payload)
  if (!encodedPayload) {
    return null
  }

  const shareUrl = new URL(window.location.href)
  shareUrl.searchParams.set(SHARE_BUILD_QUERY_KEY, encodedPayload)
  return shareUrl
}

function parseSharedBuildFromSearch(searchValue, { models, schemaVersion, playerTalentModifiers }) {
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
  if (!Number.isFinite(codecVersion) || codecVersion !== SHARE_BUILD_CODEC_VERSION) {
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

function normalizeShareMetadata(rawMetadata) {
  if (!rawMetadata || typeof rawMetadata !== 'object') {
    return null
  }

  const title = typeof rawMetadata.title === 'string'
    ? rawMetadata.title.trim().slice(0, 80)
    : ''
  const description = typeof rawMetadata.description === 'string'
    ? rawMetadata.description.trim().slice(0, 240)
    : ''

  if (!title && !description) {
    return null
  }

  return {
    title,
    description
  }
}

function findDuplicateSavedBuild({ savedBuilds, title, modelId, contextId }) {
  const normalizedTitle = normalizeSavedBuildTitle(title)
  const normalizedSubjectKey = normalizeSavedBuildSubjectKey({ modelId, contextId })
  if (!normalizedTitle) {
    return null
  }

  if (!normalizedSubjectKey) {
    return null
  }

  return savedBuilds.find((savedBuild) => {
    return (
      normalizeSavedBuildTitle(savedBuild?.title) === normalizedTitle
      && normalizeSavedBuildSubjectKey({
        modelId: savedBuild?.modelId,
        contextId: savedBuild?.contextId || savedBuild?.archetypeId || ''
      }) === normalizedSubjectKey
    )
  }) || null
}

function normalizeSavedBuildTitle(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim().toLocaleLowerCase()
}

function normalizeSavedBuildSubjectKey({ modelId, contextId }) {
  const normalizedModelId = modelId === 'Creature'
    ? 'Creature'
    : (modelId === BLUEPRINT_MODEL_ID ? BLUEPRINT_MODEL_ID : 'Player')

  if (normalizedModelId === 'Creature' || normalizedModelId === BLUEPRINT_MODEL_ID) {
    const normalizedContextId = typeof contextId === 'string' ? contextId.trim() : ''
    return normalizedContextId ? `${normalizedModelId}:${normalizedContextId}` : ''
  }

  return 'Player'
}

function encodeSharedBuildPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  try {
    return encodeUtf8Base64Url(JSON.stringify(payload))
  } catch {
    return ''
  }
}

function normalizeTalentState(rawTalents) {
  if (!rawTalents || typeof rawTalents !== 'object' || Array.isArray(rawTalents)) {
    return {}
  }

  const nextTalents = {}

  Object.entries(rawTalents).forEach(([treeId, treeTalents]) => {
    if (!treeId || !treeTalents || typeof treeTalents !== 'object' || Array.isArray(treeTalents)) {
      return
    }

    const nextTreeTalents = {}
    Object.entries(treeTalents).forEach(([talentId, rawRank]) => {
      if (!talentId) return
      const rank = Math.floor(Number(rawRank))
      if (!Number.isFinite(rank) || rank < 0) return
      nextTreeTalents[talentId] = rank
    })

    if (Object.keys(nextTreeTalents).length > 0) {
      nextTalents[treeId] = nextTreeTalents
    }
  })

  return nextTalents
}

function countMissingPrerequisitesInBuild(talentState, model) {
  if (!model?.archetypes) {
    return 0
  }

  const treeLookup = {}
  Object.values(model.archetypes).forEach((archetype) => {
    Object.values(archetype?.trees ?? {}).forEach((tree) => {
      treeLookup[tree.id] = tree
    })
  })

  let issueCount = 0

  Object.entries(talentState ?? {}).forEach(([treeId, treeTalents]) => {
    const tree = treeLookup[treeId]
    if (!tree?.talents) {
      return
    }

    const treePoints = Object.values(treeTalents ?? {}).reduce((total, rankValue) => {
      const rank = Number(rankValue)
      return total + (Number.isFinite(rank) ? rank : 0)
    }, 0)

    Object.entries(treeTalents ?? {}).forEach(([talentId, rankValue]) => {
      const rank = Number(rankValue)
      if (!Number.isFinite(rank) || rank <= 0) {
        return
      }

      const talent = tree.talents[talentId]
      if (!talent) {
        return
      }

      if (shouldHideTalent(talent)) {
        return
      }

      const requiredRank = talent.requiredRank
      const requiredPoints = requiredRank ? RANK_INVESTMENTS[requiredRank] : 0
      const meetsRankRequirement = !requiredRank || treePoints >= requiredPoints

      const requiredTalents = resolveEffectiveRequiredTalentIds(talent.requiredTalents, tree.talents)
      const meetsTalentRequirement = requiredTalents.length === 0 || requiredTalents.some((requiredTalentId) => {
        return (treeTalents?.[requiredTalentId] ?? 0) > 0
      })

      if (!meetsRankRequirement || !meetsTalentRequirement) {
        issueCount += 1
      }
    })
  })

  return issueCount
}

function getTalentRankCount(talent) {
  if (!talent || typeof talent !== 'object') {
    return 0
  }

  const explicitRankCount = Number(talent.rankCount)
  if (Number.isFinite(explicitRankCount) && explicitRankCount >= 0) {
    return explicitRankCount
  }

  const rewards = talent.rewards
  const rewardRankCount = Array.isArray(rewards) ? rewards.length : null

  if (isRerouteTalent(talent)) {
    return 0
  }

  if (rewardRankCount === null) {
    return 1
  }

  if (rewardRankCount > 0) {
    return rewardRankCount
  }

  return isLikelyLegacyRerouteTalent(talent) ? 0 : 1
}

function shouldHideTalent(talent) {
  return getTalentRankCount(talent) <= 0
}

function isRerouteTalent(talent) {
  return talent?.type === 'Reroute' || talent?.talentType === 'Reroute'
}

function isLikelyLegacyRerouteTalent(talent) {
  return (talent?.size?.x ?? 0) === 0 && (talent?.size?.y ?? 0) === 0
}

function resolveEffectiveRequiredTalentIds(requiredTalents, talentMap) {
  if (!Array.isArray(requiredTalents) || requiredTalents.length === 0) {
    return []
  }

  const resolved = []
  const seen = new Set()

  requiredTalents.forEach((requiredTalentId) => {
    const expandedIds = expandRequiredTalentId(requiredTalentId, talentMap, new Set())
    expandedIds.forEach((expandedId) => {
      if (seen.has(expandedId)) {
        return
      }

      seen.add(expandedId)
      resolved.push(expandedId)
    })
  })

  return resolved
}

function expandRequiredTalentId(requiredTalentId, talentMap, visiting) {
  if (!requiredTalentId || visiting.has(requiredTalentId)) {
    return []
  }

  const requiredTalent = talentMap?.[requiredTalentId]
  if (!requiredTalent) {
    return [requiredTalentId]
  }

  if (!shouldHideTalent(requiredTalent)) {
    return [requiredTalentId]
  }

  const nestedRequiredTalents = requiredTalent.requiredTalents ?? []
  if (nestedRequiredTalents.length === 0) {
    return []
  }

  visiting.add(requiredTalentId)
  const nested = nestedRequiredTalents.flatMap((nestedId) => {
    return expandRequiredTalentId(nestedId, talentMap, visiting)
  })
  visiting.delete(requiredTalentId)

  return nested
}

function hasMeaningfulBuildState({ modelId, archetypeId, skilledTalents, selectedPlayerModifierIds, models }) {
  const normalizedModelId = modelId === 'Creature'
    ? 'Creature'
    : (modelId === BLUEPRINT_MODEL_ID ? BLUEPRINT_MODEL_ID : 'Player')

  if (normalizedModelId === 'Player') {
    return hasAnySpentPoints(skilledTalents) || normalizePlayerModifierIds(selectedPlayerModifierIds).length > 0
  }

  if (normalizedModelId === 'Creature') {
    const creatureModel = models?.Creature
    const baselineState = ensureCreatureArchetypeBuild({}, creatureModel, archetypeId)
    const normalizedCurrentState = ensureCreatureArchetypeBuild(skilledTalents ?? {}, creatureModel, archetypeId)

    return !areTalentStatesEqual(normalizedCurrentState, baselineState)
  }

  const blueprintModel = models?.[BLUEPRINT_MODEL_ID]
  const archetype = blueprintModel?.archetypes?.[archetypeId]
  if (!archetype) {
    return false
  }

  const normalizedCurrentState = pickTalentsForTreeIds(
    skilledTalents ?? {},
    getArchetypeTreeIds(archetype)
  )

  return hasAnySpentPoints(normalizedCurrentState)
}

function hasAnySpentPoints(talentState) {
  return Object.values(talentState ?? {}).some((treeTalents) => {
    return Object.values(treeTalents ?? {}).some((rankValue) => {
      const rank = Number(rankValue)
      return Number.isFinite(rank) && rank > 0
    })
  })
}

function normalizePlayerModifierIds(rawModifierIds, availableModifiers) {
  if (!Array.isArray(rawModifierIds)) {
    return []
  }

  const allowedIds = new Set(
    Array.isArray(availableModifiers)
      ? availableModifiers.map((modifier) => modifier?.id).filter(Boolean)
      : []
  )

  const normalized = []
  const seen = new Set()
  rawModifierIds.forEach((modifierId) => {
    if (typeof modifierId !== 'string' || !modifierId) {
      return
    }

    if (allowedIds.size > 0 && !allowedIds.has(modifierId)) {
      return
    }

    if (seen.has(modifierId)) {
      return
    }

    seen.add(modifierId)
    normalized.push(modifierId)
  })

  return normalized
}

function resolveModifierLabel(modifierId, modifierLabels) {
  if (typeof modifierId !== 'string' || !modifierId) {
    return ''
  }

  const localizedLabel = modifierLabels?.[modifierId]
  if (typeof localizedLabel === 'string' && localizedLabel.trim()) {
    return localizedLabel.trim()
  }

  return modifierId
}

function areStringArraysEqual(left, right) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

function getPlayerTalentPointBonus(selectedModifierIds, availableModifiers) {
  const normalizedSelectedIds = normalizePlayerModifierIds(selectedModifierIds, availableModifiers)
  if (!normalizedSelectedIds.length || !Array.isArray(availableModifiers)) {
    return 0
  }

  const modifierById = new Map(
    availableModifiers
      .filter((modifier) => modifier && typeof modifier === 'object' && modifier.id)
      .map((modifier) => [modifier.id, modifier])
  )

  return normalizedSelectedIds.reduce((total, modifierId) => {
    const modifier = modifierById.get(modifierId)
    const points = Number(modifier?.talentPointModifier)
    return total + (Number.isFinite(points) ? points : 0)
  }, 0)
}

function getMaxPlayerTalentPoints(selectedModifierIds, availableModifiers) {
  return MAX_TALENT_POINTS + getPlayerTalentPointBonus(selectedModifierIds, availableModifiers)
}

function areTalentStatesEqual(leftState, rightState) {
  const left = normalizeTalentState(leftState)
  const right = normalizeTalentState(rightState)

  const leftTreeIds = Object.keys(left)
  const rightTreeIds = Object.keys(right)
  if (leftTreeIds.length !== rightTreeIds.length) {
    return false
  }

  return leftTreeIds.every((treeId) => {
    if (!Object.hasOwn(right, treeId)) {
      return false
    }

    const leftTree = left[treeId] ?? {}
    const rightTree = right[treeId] ?? {}
    const leftTalentIds = Object.keys(leftTree)
    const rightTalentIds = Object.keys(rightTree)

    if (leftTalentIds.length !== rightTalentIds.length) {
      return false
    }

    return leftTalentIds.every((talentId) => rightTree[talentId] === leftTree[talentId])
  })
}

function encodeUtf8Base64Url(value) {
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

function decodeBase64UrlUtf8(value) {
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

function readSavedBuildsFromStorage() {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(SAVED_BUILDS_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string')
  } catch {
    return []
  }
}

function writeSavedBuildsToStorage(savedBuilds) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(SAVED_BUILDS_STORAGE_KEY, JSON.stringify(savedBuilds ?? []))
  } catch {
    // ignore write failures
  }
}

function readActiveBuildsFromStorage() {
  if (typeof window === 'undefined') {
    return {
      lastContext: { modelId: 'Player', archetypeId: '' },
      player: { archetypeId: '', skilledTalents: {}, modifierIds: [], metadata: null },
      creatures: {},
      blueprints: {}
    }
  }

  try {
    const raw = window.localStorage.getItem(ACTIVE_BUILD_STORAGE_KEY)
    if (!raw) {
      return {
        lastContext: { modelId: 'Player', archetypeId: '' },
        player: { archetypeId: '', skilledTalents: {}, modifierIds: [], metadata: null },
        creatures: {},
        blueprints: {}
      }
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid active build snapshot')

    const player = parsed.player && typeof parsed.player === 'object'
      ? {
        archetypeId: typeof parsed.player.archetypeId === 'string' ? parsed.player.archetypeId : '',
        skilledTalents: parsed.player.skilledTalents && typeof parsed.player.skilledTalents === 'object'
          ? parsed.player.skilledTalents
          : {},
        modifierIds: normalizePlayerModifierIds(parsed.player.modifierIds),
        metadata: normalizeShareMetadata(parsed.player.metadata)
      }
      : {
        archetypeId: '',
        skilledTalents: {},
        modifierIds: [],
        metadata: null
      }

    const creatures = {}
    if (parsed.creatures && typeof parsed.creatures === 'object') {
      Object.entries(parsed.creatures).forEach(([archetypeId, creatureBuild]) => {
        if (!archetypeId || typeof creatureBuild !== 'object' || !creatureBuild) return
        creatures[archetypeId] = {
          archetypeId,
          skilledTalents: creatureBuild.skilledTalents && typeof creatureBuild.skilledTalents === 'object'
            ? creatureBuild.skilledTalents
            : {},
          metadata: normalizeShareMetadata(creatureBuild.metadata)
        }
      })
    }

    const blueprints = {}
    if (parsed.blueprints && typeof parsed.blueprints === 'object') {
      Object.entries(parsed.blueprints).forEach(([archetypeId, blueprintBuild]) => {
        if (!archetypeId || typeof blueprintBuild !== 'object' || !blueprintBuild) return
        blueprints[archetypeId] = {
          archetypeId,
          skilledTalents: blueprintBuild.skilledTalents && typeof blueprintBuild.skilledTalents === 'object'
            ? blueprintBuild.skilledTalents
            : {},
          metadata: normalizeShareMetadata(blueprintBuild.metadata)
        }
      })
    }

    const lastContext = parsed.lastContext && typeof parsed.lastContext === 'object'
      ? {
        modelId: parsed.lastContext.modelId === 'Creature'
          ? 'Creature'
          : (parsed.lastContext.modelId === BLUEPRINT_MODEL_ID ? BLUEPRINT_MODEL_ID : 'Player'),
        archetypeId: typeof parsed.lastContext.archetypeId === 'string' ? parsed.lastContext.archetypeId : ''
      }
      : {
        modelId: 'Player',
        archetypeId: ''
      }

    return { lastContext, player, creatures, blueprints }
  } catch {
    return {
      lastContext: { modelId: 'Player', archetypeId: '' },
      player: { archetypeId: '', skilledTalents: {}, modifierIds: [], metadata: null },
      creatures: {},
      blueprints: {}
    }
  }
}

function writeActiveBuildsToStorage(activeBuilds) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(ACTIVE_BUILD_STORAGE_KEY, JSON.stringify(activeBuilds ?? {}))
  } catch {
    // ignore write failures
  }
}

function getArchetypeTreeIds(archetype) {
  return Object.values(archetype?.trees ?? {}).map((tree) => tree.id)
}

function pickTalentsForTreeIds(talentState, treeIds) {
  const result = {}
  treeIds.forEach((treeId) => {
    const treeTalents = talentState?.[treeId]
    if (!treeTalents || typeof treeTalents !== 'object') return
    if (Object.keys(treeTalents).length === 0) return
    result[treeId] = treeTalents
  })
  return result
}

function ensureCreatureArchetypeBuild(talentState, creatureModel, archetypeId) {
  if (!creatureModel || creatureModel.id !== 'Creature') {
    return talentState ?? {}
  }

  const archetype = creatureModel.archetypes?.[archetypeId]
  if (!archetype) {
    return {}
  }

  const treeIds = getArchetypeTreeIds(archetype)
  const scopedTalents = pickTalentsForTreeIds(talentState ?? {}, treeIds)
  const originByTree = getCreatureOriginTalentByTree(creatureModel)
  const nextState = { ...scopedTalents }

  treeIds.forEach((treeId) => {
    const originTalentId = originByTree[treeId]
    if (!originTalentId) return
    const existingTree = nextState[treeId] ?? {}
    const currentRank = Number(existingTree[originTalentId] ?? 0)
    if (currentRank >= 1) return
    nextState[treeId] = {
      ...existingTree,
      [originTalentId]: 1
    }
  })

  return nextState
}

function getScopedArchetypeTalentState(talentState, model, archetypeId) {
  const archetype = model?.archetypes?.[archetypeId]
  if (!archetype) {
    return {}
  }

  return pickTalentsForTreeIds(
    normalizeTalentState(talentState ?? {}),
    getArchetypeTreeIds(archetype)
  )
}

function createNextActiveBuildsSnapshot({
  previous,
  modelId,
  archetypeId,
  skilledTalents,
  selectedPlayerModifierIds,
  models,
  metadata
}) {
  const baseline = previous && typeof previous === 'object'
    ? previous
    : {
      lastContext: { modelId: 'Player', archetypeId: '' },
      player: { archetypeId: '', skilledTalents: {}, modifierIds: [], metadata: null },
      creatures: {},
      blueprints: {}
    }

  const next = {
    lastContext: {
      modelId: modelId === 'Creature'
        ? 'Creature'
        : (modelId === BLUEPRINT_MODEL_ID ? BLUEPRINT_MODEL_ID : 'Player'),
      archetypeId: archetypeId || ''
    },
    player: {
      archetypeId: baseline.player?.archetypeId || '',
      skilledTalents: baseline.player?.skilledTalents ?? {},
      modifierIds: normalizePlayerModifierIds(baseline.player?.modifierIds),
      metadata: normalizeShareMetadata(baseline.player?.metadata)
    },
    creatures: { ...(baseline.creatures ?? {}) },
    blueprints: { ...(baseline.blueprints ?? {}) }
  }

  if (modelId === 'Creature') {
    const creatureModel = models?.Creature
    const normalizedSkilledTalents = ensureCreatureArchetypeBuild(skilledTalents, creatureModel, archetypeId)
    if (archetypeId) {
      next.creatures[archetypeId] = {
        archetypeId,
        skilledTalents: normalizedSkilledTalents,
        metadata: normalizeShareMetadata(metadata)
      }
    }
    return next
  }

  if (modelId === BLUEPRINT_MODEL_ID) {
    if (archetypeId) {
      const blueprintModel = models?.[BLUEPRINT_MODEL_ID]
      const archetype = blueprintModel?.archetypes?.[archetypeId]
      const normalizedSkilledTalents = archetype
        ? pickTalentsForTreeIds(skilledTalents ?? {}, getArchetypeTreeIds(archetype))
        : {}
      next.blueprints[archetypeId] = {
        archetypeId,
        skilledTalents: normalizedSkilledTalents,
        metadata: normalizeShareMetadata(metadata)
      }
    }
    return next
  }

  next.player = {
    archetypeId: archetypeId || '',
    skilledTalents: skilledTalents ?? {},
    modifierIds: normalizePlayerModifierIds(selectedPlayerModifierIds),
    metadata: normalizeShareMetadata(metadata)
  }

  return next
}

function getActiveBuildMetadata(activeBuilds, modelId, archetypeId) {
  if (modelId === 'Creature') {
    return normalizeShareMetadata(activeBuilds?.creatures?.[archetypeId]?.metadata)
  }

  if (modelId === BLUEPRINT_MODEL_ID) {
    return normalizeShareMetadata(activeBuilds?.blueprints?.[archetypeId]?.metadata)
  }

  return normalizeShareMetadata(activeBuilds?.player?.metadata)
}

function resolveSavedBuildContext(savedBuild, data, localeStrings) {
  const modelId = savedBuild?.modelId
  const isCreatureBuild = savedBuild?.buildType === 'creature' || modelId === 'Creature'
  const isBlueprintBuild = savedBuild?.buildType === 'blueprint' || modelId === BLUEPRINT_MODEL_ID

  if (!isCreatureBuild && !isBlueprintBuild) {
    return {
      name: 'Player',
      icon: ''
    }
  }

  const contextId = savedBuild?.contextId || savedBuild?.archetypeId || ''
  const targetModelId = isBlueprintBuild ? BLUEPRINT_MODEL_ID : 'Creature'
  const fallbackName = isBlueprintBuild ? contextId || 'Tech Tier' : contextId || 'Creature'
  const archetype = data?.models?.[targetModelId]?.archetypes?.[contextId]

  return {
    name: savedBuild?.contextName
      || resolveLocalizedValue(archetype?.display, localeStrings, fallbackName),
    icon: savedBuild?.contextIcon
      || resolveAssetImagePath(archetype?.icon)
      || ''
  }
}

function formatSavedBuildTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time'
  }

  return date.toLocaleString()
}

function parseNsLoc(value) {
  if (!value || typeof value !== 'string') {
    return null
  }

  const match = value.match(/NSLOCTEXT\("([^"]+)",\s*"([^"]+)",\s*"((?:[^"\\]|\\.)*)"\)/)
  if (!match) {
    return null
  }

  return {
    category: match[1],
    key: match[2],
    text: match[3].replace(/\\(["'])/g, '$1')
  }
}

function resolveAssetImagePath(unrealPath) {
  if (!unrealPath || typeof unrealPath !== 'string' || !unrealPath.startsWith('/Game/')) {
    return null
  }

  const pathWithoutPrefix = unrealPath.slice('/Game/'.length)
  const packagePath = pathWithoutPrefix.split('.')[0]

  if (!packagePath) {
    return null
  }

  return resolveAppUrl(`Exports/Icarus/Content/${packagePath}.png`)
}

function extractModifierId(effect) {
  const rawKey = effect?.rawKey
  if (!rawKey || typeof rawKey !== 'string') {
    return ''
  }

  const match = rawKey.match(/Value="([^"]+)"/)
  if (match) {
    return match[1]
  }

  return rawKey
}

function resolveModifierEffectTemplate(modifierId, value, localeStrings) {
  if (!modifierId) {
    return ''
  }

  const positiveDescription = localeStrings?.[`${modifierId}-PositiveDescription`] || ''
  const negativeDescription = localeStrings?.[`${modifierId}-NegativeDescription`] || ''

  if (value < 0) {
    return negativeDescription || positiveDescription || ''
  }

  return positiveDescription || negativeDescription || ''
}

function interpolateEffectTemplate(template, value) {
  if (!template) {
    return ''
  }

  if (!template.includes('{0}')) {
    return template
  }

  return template.replace(/\{0\}/g, formatTemplateInterpolationValue(value, template))
}

function formatTemplateInterpolationValue(value, template) {
  if (value === null || value === undefined) return ''

  const num = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(num)) return String(value)

  const hasExplicitSignInTemplate = /[+-]\s*\{0\}/.test(template)
  const interpolationValue = hasExplicitSignInTemplate ? Math.abs(num) : num

  if (Number.isInteger(interpolationValue)) {
    return String(interpolationValue)
  }

  return interpolationValue.toFixed(2).replace(/\.0+$|(?<=\.[0-9]*[1-9])0+$/g, '')
}

function formatModifierTotal(modifierId, value) {
  if (value === null || value === undefined) {
    return '0'
  }

  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) {
    return String(value)
  }

  const suffixMatch = modifierId?.match(/_([+-]?)(%?)$/)
  const hasPercentSuffix = suffixMatch?.[2] === '%'
  const numberText = Number.isInteger(numericValue)
    ? String(numericValue)
    : numericValue.toFixed(2).replace(/\.0+$|(?<=\.[0-9]*[1-9])0+$/g, '')

  if (hasPercentSuffix) {
    return `${numberText}%`
  }

  return numberText
}

function EffectsSummarySection({ rows }) {
  const hasFallbackValue = rows.some((entry) => entry.hasFallbackValue)

  return (
    <div className="effects-table-wrap">
      <table className="effects-table" aria-label="Aggregated effects">
        <tbody>
          {rows.length > 0 ? (
            rows.map((entry) => (
              <tr key={entry.modifierId}>
                <td className="effects-effect-cell" title={entry.modifierId}>{entry.displayText}</td>
                {hasFallbackValue ? (
                  <td className="effects-total-column">{entry.hasFallbackValue ? entry.fallbackValue : ''}</td>
                ) : null}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={hasFallbackValue ? 2 : 1} className="effects-empty">No active effects from selected talents.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

async function fetchLocaleStrings(localeCode) {
  const response = await fetch(`${LOCALE_BASE_URL}/${localeCode}/Game.json`)
  if (!response.ok) {
    return null
  }

  const json = await response.json()
  return flattenLocalizationByKey(json)
}

async function fetchModifierLabels() {
  const response = await fetch(MODIFIER_LABELS_URL)
  if (!response.ok) {
    return {}
  }

  const json = await response.json()
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return {}
  }

  return json
}

async function fetchLocaleManifest() {
  const response = await fetch(LOCALE_CONFIG_URL)
  if (!response.ok) {
    return null
  }

  const json = await response.json()
  return {
    nativeCulture: json.NativeCulture || DEFAULT_LOCALE,
    compiledCultures: Array.isArray(json.CompiledCultures) ? json.CompiledCultures : []
  }
}

function getLocaleLabel(localeCode) {
  try {
    const display = new Intl.DisplayNames([localeCode], { type: 'language' })
    const label = display.of(localeCode)
    return label ? normalizeLocaleLabel(label) : localeCode
  } catch {
    return localeCode
  }
}

function normalizeLocaleLabel(label) {
  if (!label || typeof label !== 'string') {
    return label
  }

  return label.replace(/^\p{Ll}/u, (character) => character.toLocaleUpperCase())
}

function LocaleDropdown({ locales, selectedLocale, onSelectLocale }) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return

    const handleDocumentClick = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentClick)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleDocumentClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const selectedLabel = getLocaleLabel(selectedLocale)
  const SelectedFlag = LOCALE_FLAG_COMPONENTS[selectedLocale] ?? null

  return (
    <div className="locale-dropdown" ref={containerRef}>
      <button
        type="button"
        className="locale-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="locale-trigger-content">
          {SelectedFlag ? <SelectedFlag className="locale-flag" title="" /> : null}
          <span className="locale-trigger-label">{selectedLabel}</span>
        </span>
        <span className="locale-trigger-caret">▾</span>
      </button>

      {isOpen && (
        <div className="locale-menu" role="listbox" aria-label="Language">
          {locales.map((localeCode) => {
            const LocaleFlag = LOCALE_FLAG_COMPONENTS[localeCode] ?? null
            const isActive = localeCode === selectedLocale

            return (
              <button
                key={localeCode}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`locale-option ${isActive ? 'active' : ''}`}
                onClick={() => {
                  onSelectLocale(localeCode)
                  setIsOpen(false)
                }}
              >
                {LocaleFlag ? <LocaleFlag className="locale-flag" title="" /> : null}
                <span>{getLocaleLabel(localeCode)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CreatureArchetypeDropdown({
  groupId,
  groupLabel,
  groupIconPath,
  options,
  selectedOptionId,
  isActive,
  onSelectOption
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return

    const handleDocumentClick = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentClick)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleDocumentClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? null
  const selectedLabel = selectedOption?.label || 'Select'

  return (
    <div className="creature-meta-dropdown" ref={containerRef}>
      <button
        type="button"
        className={`meta-chip creature-meta-dropdown-trigger ${isActive ? 'active' : ''}`.trim()}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`creature-meta-menu-${groupId}`}
        onClick={() => setIsOpen((previous) => !previous)}
      >
        {groupIconPath ? (
          <img
            src={groupIconPath}
            alt=""
            className="meta-chip-icon"
            onError={(event) => {
              event.target.style.display = 'none'
            }}
          />
        ) : null}
        <span className="meta-chip-label">{groupLabel}</span>
        <span className="creature-meta-selected" title={selectedLabel}>
          {selectedOption?.iconPath ? (
            <img
              src={selectedOption.iconPath}
              alt=""
              className="creature-meta-option-icon"
              onError={(event) => {
                event.target.style.display = 'none'
              }}
            />
          ) : null}
          <span className="creature-meta-selected-label">{selectedLabel}</span>
        </span>
        <span className="creature-meta-caret" aria-hidden="true">▾</span>
      </button>

      {isOpen && (
        <div
          className="creature-meta-menu"
          id={`creature-meta-menu-${groupId}`}
          role="listbox"
          aria-label={`${groupLabel} archetypes`}
        >
          {options.map((option) => {
            const isSelected = option.id === selectedOptionId

            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`creature-meta-option ${isSelected ? 'active' : ''}`.trim()}
                onClick={() => {
                  onSelectOption(option.id)
                  setIsOpen(false)
                }}
              >
                {option.iconPath ? (
                  <img
                    src={option.iconPath}
                    alt=""
                    className="creature-meta-option-icon"
                    onError={(event) => {
                      event.target.style.display = 'none'
                    }}
                  />
                ) : null}
                <span className="creature-meta-option-label">{option.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function getSavedLocaleFromCookie() {
  if (typeof document === 'undefined') {
    return null
  }

  const pairs = document.cookie ? document.cookie.split('; ') : []
  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.split('=')
    if (rawKey === LOCALE_COOKIE_NAME) {
      const value = rest.join('=')
      return value ? decodeURIComponent(value) : null
    }
  }

  return null
}

function setLocaleCookie(localeCode) {
  if (typeof document === 'undefined') {
    return
  }

  const maxAgeSeconds = 60 * 60 * 24 * 365
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(localeCode)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`
}

function flattenLocalizationByKey(localeJson) {
  const byKey = {}
  if (!localeJson || typeof localeJson !== 'object') {
    return byKey
  }

  Object.entries(localeJson).forEach(([category, categoryEntries]) => {
    if (!categoryEntries || typeof categoryEntries !== 'object' || Array.isArray(categoryEntries)) {
      return
    }

    Object.entries(categoryEntries).forEach(([key, value]) => {
      if (typeof value === 'string') {
        byKey[key] = value
        byKey[`${category}:${key}`] = value
      }
    })
  })

  return byKey
}

export default App
