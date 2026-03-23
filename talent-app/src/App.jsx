import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, FolderOpen, Github, Save, Share2, Trash2 } from 'lucide-react'
import '@fontsource/orbitron/800.css'
import './App.css'
import TalentTreeCanvas from './TalentTreeCanvas'
import { resolveAssetImagePath, resolveLocalizedValue, areStringArraysEqual, extractModifierId } from './utils.js'
import { shouldHideTalent, resolveEffectiveRequiredTalentIds, getTreeTalentPoints, summarizeTalentPoints } from './talentUtils.js'
import { resolveModifierEffectTemplate, interpolateEffectTemplate, formatModifierTotal } from './effectUtils.js'
import {
  VERSIONS_URL, getDataUrl, getBlueprintDataUrl, getLocaleBaseUrl, getLocaleConfigUrl,
  DEFAULT_LOCALE, SHARE_BUILD_QUERY_KEY, SAVED_BUILD_ACTION_FEEDBACK_MS, SAVED_BUILD_DELETE_ANIMATION_MS,
  ENABLED_MODELS, BLUEPRINT_MODEL_ID, RANK_INVESTMENTS, MAX_TALENT_POINTS, MAX_SOLO_POINTS,
  CREATURE_MOUNT_LEVEL_CAP, CREATURE_BASE_ARCHETYPE_ID, HIDDEN_CREATURE_ARCHETYPE_IDS,
  CREATURE_TAB_GROUPS, GITHUB_REPO_URL, ROCKETWERKZ_URL, ICARUS_STEAM_URL, TOP_MENU_ICON_UNREAL_PATHS
} from './constants.js'
import { normalizePlayerModifierIds, resolveModifierLabel, getPlayerTalentPointBonus, getMaxPlayerTalentPoints } from './modifierUtils.js'
import {
  getCreatureTreeProgressById, groupCreatureArchetypesByCategory, getCreatureArchetypeCategory,
  getCreatureOriginTalentByTree, hasCreatureOvercap, hasPlayerOvercap
} from './modelUtils.js'
import {
  normalizeTalentState, normalizeShareMetadata, findDuplicateSavedBuild, hasMeaningfulBuildState,
  areTalentStatesEqual, ensureCreatureArchetypeBuild, getScopedArchetypeTalentState,
  createNextActiveBuildsSnapshot, getActiveBuildMetadata, createSavedBuildId,
  resolveSavedBuildContext, formatSavedBuildTimestamp
} from './buildUtils.js'
import { encodeSharedBuildPayload, createShareBuildPayload, createShareUrlFromPayload, parseSharedBuildFromSearch, extractVersionFromShareParam } from './buildSerializer.js'
import { readSavedBuildsFromStorage, writeSavedBuildsToStorage, readActiveBuildsFromStorage, writeActiveBuildsToStorage } from './storage.js'
import { getSavedLocaleFromCookie, setLocaleCookie, fetchLocaleStrings, fetchModifierLabels, fetchLocaleManifest } from './localeUtils.js'
import { DataProvider } from './DataContext.jsx'
import { LocaleProvider } from './LocaleContext.jsx'
import { BuildProvider } from './BuildContext.jsx'
import { SavedBuildsProvider } from './SavedBuildsContext.jsx'
import DisclaimerDialog from './DisclaimerDialog.jsx'
import AppFooter from './AppFooter.jsx'
import EffectsSummarySection from './EffectsSummarySection.jsx'
import LocaleDropdown from './LocaleDropdown.jsx'
import VersionDropdown from './VersionDropdown.jsx'
import CreatureArchetypeDropdown from './CreatureArchetypeDropdown.jsx'

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
  const [versionsIndex, setVersionsIndex] = useState(null)
  const [selectedVersionId, setSelectedVersionId] = useState(null)
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
    Player: resolveAssetImagePath(TOP_MENU_ICON_UNREAL_PATHS.Player, selectedVersionId, versionsIndex) || '',
    Creature: resolveAssetImagePath(TOP_MENU_ICON_UNREAL_PATHS.Creature, selectedVersionId, versionsIndex) || '',
    TechTree: resolveAssetImagePath(TOP_MENU_ICON_UNREAL_PATHS.TechTree, selectedVersionId, versionsIndex) || '',
    Workshop: resolveAssetImagePath(TOP_MENU_ICON_UNREAL_PATHS.Workshop, selectedVersionId, versionsIndex) || ''
  }), [selectedVersionId, versionsIndex])

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

  // Phase 1: load versions.json on mount, pre-decode URL for version hint
  useEffect(() => {
    let active = true

    const loadVersions = async () => {
      const sharedVersionId = extractVersionFromShareParam(window.location.search)
      const response = await fetch(VERSIONS_URL)
      const index = await response.json()
      if (!active) return
      setVersionsIndex(index)
      setSelectedVersionId(sharedVersionId && index.versions?.some((v) => v.id === sharedVersionId)
        ? sharedVersionId
        : index.latest)
    }

    loadVersions().catch((err) => console.error('Failed to load versions index', err))

    return () => { active = false }
  }, [])

  // Phase 2: load game data whenever selectedVersionId changes
  useEffect(() => {
    if (!selectedVersionId) return
    let active = true

    const selectedVersion = versionsIndex?.versions?.find((v) => v.id === selectedVersionId)

    const loadData = async () => {
      const talentsResponse = await fetch(getDataUrl(selectedVersionId))
      const talentsJson = await talentsResponse.json()

      let blueprintsJson = null
      if (selectedVersion?.features?.blueprints !== false) {
        try {
          const blueprintsResponse = await fetch(getBlueprintDataUrl(selectedVersionId))
          if (blueprintsResponse.ok) {
            blueprintsJson = await blueprintsResponse.json()
          }
        } catch (error) {
          console.warn('Blueprint data not available, Tech Tree mode will be disabled.', error)
        }
      }

      if (!active) return
      setData(mergeDatasets(talentsJson, blueprintsJson))
      // Reset active-build hydration so the new data triggers re-hydration
      setHasHydratedActiveBuild(false)
    }

    loadData().catch((err) => console.error('Failed to load data', err))

    return () => { active = false }
  }, [selectedVersionId]) // eslint-disable-line react-hooks/exhaustive-deps

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
        
        // Ensure Player_Crafting is always skilled in Blueprint_T1_Player for shared blueprint builds
        let skilledTalents = sharedBuild.skilledTalents
        if (sharedBuild.modelId === BLUEPRINT_MODEL_ID) {
          skilledTalents = { ...sharedBuild.skilledTalents }
          if (!skilledTalents['Blueprint_T1_Player']) {
            skilledTalents['Blueprint_T1_Player'] = {}
          }
          skilledTalents['Blueprint_T1_Player'] = {
            ...skilledTalents['Blueprint_T1_Player'],
            'Player_Crafting': 1
          }
        }
        
        const hasOvercap = sharedBuild.modelId === 'Creature'
          ? hasCreatureOvercap(skilledTalents, nextModel)
          : (sharedBuild.modelId === 'Player' && hasPlayerOvercap(
            skilledTalents,
            nextModel,
            getMaxPlayerTalentPoints(nextPlayerModifierIds, data.playerTalentModifiers)
          ))

        setModelId(sharedBuild.modelId)
        setArchetypeId(sharedBuild.archetypeId)
        setSkilledTalents(skilledTalents)
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

      // Ensure Player_Crafting is always skilled in Blueprint_T1_Player
      if (resolvedArchetypeId === 'Player') {
        if (!blueprintDraft['Blueprint_T1_Player']) {
          blueprintDraft['Blueprint_T1_Player'] = {}
        }
        blueprintDraft['Blueprint_T1_Player']['Player_Crafting'] = 1
      }

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
      metadata: pendingSharedMetadata,
      versionId: selectedVersionId
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
    if (!selectedVersionId) return
    let active = true

    fetchLocaleManifest(getLocaleConfigUrl(selectedVersionId))
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
  }, [selectedVersionId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedVersionId) return
    let active = true

    const cacheKey = `${selectedVersionId}:${locale}`
    const cached = localeCacheRef.current[cacheKey]
    if (cached) {
      setLocaleStrings(cached)
      return () => {
        active = false
      }
    }

    const localeBaseUrl = getLocaleBaseUrl(selectedVersionId)

    const loadLocale = async () => {
      const requested = await fetchLocaleStrings(locale, localeBaseUrl)
      if (requested && active) {
        localeCacheRef.current[cacheKey] = requested
        setLocaleStrings(requested)
        return
      }

      if (locale !== DEFAULT_LOCALE) {
        const fallbackKey = `${selectedVersionId}:${DEFAULT_LOCALE}`
        const fallback = await fetchLocaleStrings(DEFAULT_LOCALE, localeBaseUrl)
        if (fallback && active) {
          localeCacheRef.current[fallbackKey] = fallback
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
  }, [locale, selectedVersionId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Build exclusions: exclude origin talent for Creatures, Player_Crafting for Blueprint_T1_Player
  const getExcludedTalentByTree = () => {
    if (modelId === 'Creature') {
      return creatureOriginTalentByTree
    }
    if (modelId === 'Blueprint') {
      return { 'Blueprint_T1_Player': 'Player_Crafting' }
    }
    return null
  }

  const pointsSummary = useMemo(
    () => summarizeTalentPoints(skilledTalents, treeArchetypeMap, getExcludedTalentByTree()),
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

      // Player_Crafting in blueprints is always skilled and cannot be removed
      if (modelId === 'Blueprint' && talentId === 'Player_Crafting' && newRank < 1) {
        return prev
      }

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
      versionId: selectedVersionId,
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
        versionId: selectedVersionId,
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
    if (!savedBuild) return false

    // If the saved build is from a different version, switch version first
    const buildVersionId = savedBuild.versionId ?? versionsIndex?.latest
    if (buildVersionId && buildVersionId !== selectedVersionId) {
      setSelectedVersionId(buildVersionId)
      // Data reload will trigger re-hydration; the build won't be loaded now
      return true
    }

    if (!data?.models) return false

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
      metadata: pendingSharedMetadata,
      versionId: selectedVersionId
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
      },
      versionId: savedBuild.versionId ?? selectedVersionId
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

      // Ensure Player_Crafting is always skilled in Blueprint_T1_Player
      if (nextArchetypeId === 'Player') {
        if (!normalizedSkilledTalents['Blueprint_T1_Player']) {
          normalizedSkilledTalents['Blueprint_T1_Player'] = {}
        }
        normalizedSkilledTalents['Blueprint_T1_Player']['Player_Crafting'] = 1
      }

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

  const selectedVersionEntry = versionsIndex?.versions?.find((v) => v.id === selectedVersionId) ?? null
  const isBlueprintsEnabled = selectedVersionEntry?.features?.blueprints !== false

  const dataContextValue = useMemo(() => ({
    data,
    models: data?.models ?? null,
    ranks: data?.ranks ?? {},
    localeStrings,
    modifierLabels,
    versionsIndex,
    selectedVersionId,
    setSelectedVersionId
  }), [data, localeStrings, modifierLabels, versionsIndex, selectedVersionId])

  const localeContextValue = useMemo(() => ({
    locale,
    availableLocales,
    onSelectLocale: setLocale
  }), [locale, availableLocales])

  const buildContextValue = useMemo(() => ({
    modelId,
    archetypeId,
    skilledTalents,
    selectedPlayerModifierIds: normalizedSelectedPlayerModifierIds,
    onSkillTalent: handleSkillTalent,
    onSetModelId: handleSelectModel,
    onSetArchetypeId: handleSelectArchetype,
    onResetBuild: handleResetBuild,
    pendingSharedMetadata
  }), [
    modelId, archetypeId, skilledTalents, normalizedSelectedPlayerModifierIds,
    handleSkillTalent, handleSelectModel, handleSelectArchetype, handleResetBuild,
    pendingSharedMetadata
  ])

  const savedBuildsContextValue = useMemo(() => ({
    savedBuilds,
    onOpenSaveDialog: handleOpenSaveDialog,
    onLoadBuild: handleLoadSavedBuild,
    onDeleteBuild: handleDeleteSavedBuild,
    onShareBuild: handleShareSavedBuild,
    savedBuildLoadStateById,
    savedBuildShareStateById,
    savedBuildDeleteStateById,
    savedBuildTooltip,
    onSetSavedBuildTooltip: setSavedBuildTooltip
  }), [
    savedBuilds, handleOpenSaveDialog, handleLoadSavedBuild, handleDeleteSavedBuild,
    handleShareSavedBuild, savedBuildLoadStateById, savedBuildShareStateById,
    savedBuildDeleteStateById, savedBuildTooltip
  ])

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
              {isBlueprintsEnabled && (
                <button
                  type="button"
                  className={modelId === BLUEPRINT_MODEL_ID ? 'menu-link active' : 'menu-link'}
                  onClick={() => handleSelectModel(BLUEPRINT_MODEL_ID)}
                >
                  <MenuItemLabel iconPath={topMenuIcons.TechTree} label="Tech Tree" />
                </button>
              )}
              <button type="button" className="menu-link" disabled title="Coming sooon…">
                <MenuItemLabel iconPath={topMenuIcons.Workshop} label="Workshop" />
              </button>
            </nav>
          </div>

          <div className="top-nav-right">
            {versionsIndex && (
              <VersionDropdown
                versions={versionsIndex.versions}
                selectedVersionId={selectedVersionId}
                onSelectVersion={setSelectedVersionId}
              />
            )}
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

        <AppFooter
          projectVersion={projectVersionLabel}
          calculatorVersion={calculatorVersionLabel}
          onOpenDisclaimer={() => setIsDisclaimerDialogOpen(true)}
        />

        <DisclaimerDialog
          isOpen={isDisclaimerDialogOpen}
          onClose={() => setIsDisclaimerDialogOpen(false)}
        />
      </div>
    )
  }

  return (
    <DataProvider value={dataContextValue}>
    <LocaleProvider value={localeContextValue}>
    <BuildProvider value={buildContextValue}>
    <SavedBuildsProvider value={savedBuildsContextValue}>
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
            {isBlueprintsEnabled && (
              <button
                type="button"
                className={modelId === BLUEPRINT_MODEL_ID ? 'menu-link active' : 'menu-link'}
                onClick={() => handleSelectModel(BLUEPRINT_MODEL_ID)}
              >
                <MenuItemLabel iconPath={topMenuIcons.TechTree} label="Tech Tree" />
              </button>
            )}
            <button type="button" className="menu-link" disabled title="Coming sooon…">
              <MenuItemLabel iconPath={topMenuIcons.Workshop} label="Workshop" />
            </button>
          </nav>
        </div>

        <div className="top-nav-right">
          {versionsIndex && (
            <VersionDropdown
              versions={versionsIndex.versions}
              selectedVersionId={selectedVersionId}
              onSelectVersion={setSelectedVersionId}
            />
          )}
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

      <AppFooter
        projectVersion={projectVersionLabel}
        calculatorVersion={calculatorVersionLabel}
        onOpenDisclaimer={() => setIsDisclaimerDialogOpen(true)}
      />

      <DisclaimerDialog
        isOpen={isDisclaimerDialogOpen}
        onClose={() => setIsDisclaimerDialogOpen(false)}
      />

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
    </SavedBuildsProvider>
    </BuildProvider>
    </LocaleProvider>
    </DataProvider>
  )
}


export default App
