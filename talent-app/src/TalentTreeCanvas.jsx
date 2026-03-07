import { useEffect, useMemo, useRef, useState } from 'react'
import './TalentTreeCanvas.css'

const NODE_SCALE = 0.5
const DEFAULT_EDGE_METHOD = 'YThenX'
const resolveAppUrl = (relativePath) => new URL(relativePath, document.baseURI).toString()

const scaleValue = (value) => value * NODE_SCALE

function TalentTreeCanvas({ tree, ranks, modelId, localeStrings, skillInvestments, skilledTalents, onSkillTalent, treePoints }) {
  const [hoveredTalentId, setHoveredTalentId] = useState(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const showRankProgressBars = modelId !== 'Creature'
  const talentMap = useMemo(() => tree?.talents ?? {}, [tree?.talents])

  const visibleTalentMap = useMemo(() => {
    return Object.fromEntries(
      Object.entries(talentMap).filter(([, talent]) => !shouldHideTalent(talent))
    )
  }, [talentMap])

  const effectiveRequirementsByTalentId = useMemo(() => {
    const byId = {}

    Object.entries(visibleTalentMap).forEach(([talentId, talent]) => {
      byId[talentId] = resolveEffectiveRequirements(talent.requiredTalents, talentMap)
    })

    return byId
  }, [talentMap, visibleTalentMap])

  const effectiveRequiredTalentIdsById = useMemo(() => {
    const byId = {}

    Object.entries(effectiveRequirementsByTalentId).forEach(([talentId, requirements]) => {
      byId[talentId] = uniqueValues(requirements.map((requirement) => requirement.targetId))
    })

    return byId
  }, [effectiveRequirementsByTalentId])

  // Calculate bounds
  const bounds = useMemo(() => {
    const talents = Object.values(visibleTalentMap)
    if (talents.length === 0) {
      return { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 }
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity

    talents.forEach((talent) => {
      const x = scaleValue(talent.position?.x ?? 0)
      const y = scaleValue(talent.position?.y ?? 0)
      const w = scaleValue(talent.size?.x ?? 128)
      const h = scaleValue(talent.size?.y ?? 128)

      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + w)
      maxY = Math.max(maxY, y + h)
    })

    const padding = 10
    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2
    }
  }, [visibleTalentMap])

  const talents = Object.values(visibleTalentMap)

  // Determine current rank and next rank based on points spent
  const getCurrentRankInfo = () => {
    const ranks = [
      { name: 'Novice', threshold: 0, next: 'Apprentice' },
      { name: 'Apprentice', threshold: 4, next: 'Journeyman' },
      { name: 'Journeyman', threshold: 8, next: 'Master' },
      { name: 'Master', threshold: 12, next: null }
    ]
    
    for (let i = ranks.length - 1; i >= 0; i--) {
      if (treePoints >= ranks[i].threshold) {
        return {
          currentRank: ranks[i].name,
          nextRank: ranks[i].next,
          nextThreshold: i < ranks.length - 1 ? ranks[i + 1].threshold : 12
        }
      }
    }
    
    return { currentRank: 'Novice', nextRank: 'Apprentice', nextThreshold: 4 }
  }

  const rankInfo = getCurrentRankInfo()
  const currentRankIconSrc = resolveAssetImagePath(ranks?.[rankInfo.currentRank]?.icon)
  const nextRankIconSrc = resolveAssetImagePath(ranks?.[rankInfo.nextRank]?.icon)
  const currentRankLabel = resolveI18nText(
    ranks?.[rankInfo.currentRank]?.display,
    localeStrings,
    rankInfo.currentRank
  )
  const nextRankLabel = rankInfo.nextRank
    ? resolveI18nText(ranks?.[rankInfo.nextRank]?.display, localeStrings, rankInfo.nextRank)
    : null
  const treeTitle = resolveI18nText(tree?.display, localeStrings, tree?.id ?? '')
  const treeIconSrc = resolveAssetImagePath(tree?.icon)

  // Check if player has spent enough points to unlock a talent
  const meetsPointRequirement = (talent) => {
    const requiredRank = talent.requiredRank
    if (!requiredRank) return true
    const requiredPoints = skillInvestments[requiredRank]
    return treePoints >= requiredPoints
  }

  // Check if any prerequisite talent is skilled
  const meetsPrerequisites = (talent) => {
    const requiredTalentIds = effectiveRequiredTalentIdsById[talent.id] ?? []
    if (requiredTalentIds.length === 0) return true
    return requiredTalentIds.some((talentId) => {
      return skilledTalents[talentId] && skilledTalents[talentId] > 0
    })
  }

  // Check if talent can be skilled (point requirement + any prerequisite)
  const canSkillTalent = (talent) => {
    return meetsPointRequirement(talent) && meetsPrerequisites(talent)
  }

  // Add a point to a talent (left click)
  const addPoint = (talentId) => {
    const talent = visibleTalentMap[talentId]
    if (!talent) return

    const maxRanks = getTalentRankCount(talent)
    const currentRank = skilledTalents[talentId] ?? 0

    if (maxRanks <= 0) return
    if (currentRank >= maxRanks) return // Already maxed

    if (!canSkillTalent(talent) && currentRank === 0) {
      return // Can't start skilling if requirements not met
    }

    onSkillTalent(talentId, currentRank + 1)
  }

  // Remove a point from a talent (right click)
  const removePoint = (talentId) => {
    const talent = visibleTalentMap[talentId]
    if (!talent) return

    const currentRank = skilledTalents[talentId] ?? 0

    if (currentRank <= 0) return // Already at 0

    onSkillTalent(talentId, currentRank - 1)
  }

  // Convert world coords to container coords (relative to bounds)
  const worldToContainer = (x, y) => ({
    x: scaleValue(x) - bounds.minX,
    y: scaleValue(y) - bounds.minY
  })

  return (
    <div className="talent-tree-canvas-container">
      {/* Tree mastery progress */}
      <div className="tree-progress-section">
        <div className="tree-progress-title">
          {treeIconSrc && (
            <img
              src={treeIconSrc}
              alt=""
              className="tree-progress-title-icon"
              onError={(event) => {
                event.target.style.display = 'none'
              }}
            />
          )}
          <span>{treeTitle}</span>
        </div>
        {showRankProgressBars && (
          <div className="tree-progress-labels">
            <div className="tree-progress-label-left">
              {currentRankIconSrc && (
                <img
                  src={currentRankIconSrc}
                  alt=""
                  className="tree-progress-rank-icon"
                  onError={(e) => {
                    e.target.style.display = 'none'
                  }}
                />
              )}
              Current rank: {currentRankLabel}
            </div>
            {rankInfo.nextRank && (
              <div className="tree-progress-label-right">
                Next rank: {nextRankLabel}
                {nextRankIconSrc && (
                  <img
                    src={nextRankIconSrc}
                    alt=""
                    className="tree-progress-rank-icon"
                    onError={(e) => {
                      e.target.style.display = 'none'
                    }}
                  />
                )}
              </div>
            )}
          </div>
        )}
        {showRankProgressBars && (
          <div className="tree-progress-bar-bg">
            <div
              className="tree-progress-bar-fill"
              style={{ width: `${Math.min(100, rankInfo.nextThreshold > 0 ? (treePoints / rankInfo.nextThreshold) * 100 : 0)}%` }}
            />
          </div>
        )}
      </div>

      {/* SVG Canvas for edges only */}
      <svg
        className="talent-tree-edges"
        width={bounds.width}
        height={bounds.height}
      >
        <g className="edges">
          {talents.map((talent) => {
            const fromPos = worldToContainer(
              talent.position?.x ?? 0,
              talent.position?.y ?? 0
            )
            const fromCenter = {
              x: fromPos.x + scaleValue(talent.size?.x ?? 128) / 2,
              y: fromPos.y + scaleValue(talent.size?.y ?? 128) / 2
            }

            const requirements = effectiveRequirementsByTalentId[talent.id] ?? []

            return requirements.map((requirement) => {
              const reqId = requirement.targetId
              const required = visibleTalentMap[reqId]
              if (!required) return null

              const toPos = worldToContainer(
                required.position?.x ?? 0,
                required.position?.y ?? 0
              )
              const toCenter = {
                x: toPos.x + scaleValue(required.size?.x ?? 128) / 2,
                y: toPos.y + scaleValue(required.size?.y ?? 128) / 2
              }

              const isHovered = hoveredTalentId === talent.id || hoveredTalentId === reqId
              const isRequirementFulfilled = (skilledTalents[reqId] ?? 0) > 0
              const viaTalents = requirement.viaTalentIds
                .map((viaTalentId) => talentMap[viaTalentId])
                .filter(Boolean)

              const waypoints = viaTalents.map((viaTalent) => {
                const viaPos = worldToContainer(viaTalent.position?.x ?? 0, viaTalent.position?.y ?? 0)
                return {
                  x: viaPos.x + scaleValue(viaTalent.size?.x ?? 128) / 2,
                  y: viaPos.y + scaleValue(viaTalent.size?.y ?? 128) / 2
                }
              })

              // Per-segment draw methods: first segment uses the child talent's
              // method, subsequent segments use each reroute waypoint's method
              const segmentMethods = [
                resolveEdgeMethod(talent.drawMethod),
                ...viaTalents.map((vt) => resolveEdgeMethod(vt.drawMethod))
              ]

              const edgePath = buildEdgePathWithWaypoints({
                fromCenter,
                toCenter,
                waypoints,
                segmentMethods
              })

              return (
                <path
                  key={`edge-${talent.id}-${reqId}-${requirement.viaTalentIds.join('>') || 'direct'}`}
                  d={edgePath}
                  className={`edge ${isRequirementFulfilled ? 'fulfilled' : 'unfulfilled'} ${isHovered ? 'hovered' : ''}`}
                  strokeWidth={isRequirementFulfilled ? 3 : (isHovered ? 1.5 : 1)}
                />
              )
            })
          })}
        </g>
      </svg>

      {/* HTML Talent nodes */}
      <div className="talent-nodes-container" style={{ width: bounds.width, height: bounds.height, position: 'relative' }}>
        {talents.map((talent) => {
          const pos = worldToContainer(talent.position?.x ?? 0, talent.position?.y ?? 0)
          const w = scaleValue(talent.size?.x ?? 128)
          const h = scaleValue(talent.size?.y ?? 128)
          const isHovered = hoveredTalentId === talent.id
          const maxRanks = getTalentRankCount(talent)
          const currentRank = skilledTalents[talent.id] ?? 0
          const canSkill = canSkillTalent(talent)
          const isAvailableUnskilled = canSkill && currentRank === 0
          const isSkilled = currentRank > 0
          const isDisabled = !canSkill && currentRank === 0
          const rankId = talent.requiredRank
          const rankData = rankId ? ranks?.[rankId] : null
          const talentIconSrc = resolveAssetImagePath(talent.icon)
          const rankIconSrc = resolveAssetImagePath(rankData?.icon)
          const progressPercent = (currentRank / maxRanks) * 100
          const isBlueprintNode = modelId === 'Blueprint'

          // Determine prerequisite badge flags for blueprint nodes
          const requiredFlags = Array.isArray(talent.requiredFlags) ? talent.requiredFlags : []
          const dlcFlag = requiredFlags.find((f) => f?.DataTableName === 'D_DLCPackageData')
          const hasDlcRequirement = !!dlcFlag
          const hasMissionRequirement = requiredFlags.some((f) =>
            f?.DataTableName === 'D_AccountFlags' || f?.DataTableName === 'D_CharacterFlags'
          )
          const featureLevelIconSrc = isBlueprintNode ? resolveAssetImagePath(talent.featureLevelIcon) : null
          const dlcIconSrc = dlcFlag?.dlcIcon ? resolveAssetImagePath(dlcFlag.dlcIcon) : null

          return (
            <div
              key={talent.id}
              className={`talent-node ${isHovered ? 'hovered' : ''} ${isDisabled ? 'disabled' : ''} ${isAvailableUnskilled ? 'available-unskilled' : ''} ${isSkilled ? 'skilled' : ''}`}
              style={{
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                width: `${w}px`,
                height: `${h}px`
              }}
              onMouseEnter={() => setHoveredTalentId(talent.id)}
              onMouseLeave={() => setHoveredTalentId(null)}
              onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
              onClick={() => addPoint(talent.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                removePoint(talent.id)
              }}
            >
              {/* Main frame */}
              <div className="talent-frame" />

              {/* Icon placeholder */}
              <div className="talent-icon-bg">
                {talentIconSrc && (
                  <img
                    src={talentIconSrc}
                    alt=""
                    className="talent-icon-image"
                    onError={(e) => {
                      e.target.style.display = 'none'
                    }}
                  />
                )}
              </div>

              {/* Progress bar */}
              {showRankProgressBars && (
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}

              {/* Feature-level badge (top-left inside) – which expansion introduced this blueprint */}
              {featureLevelIconSrc && (
                <img
                  src={featureLevelIconSrc}
                  alt=""
                  className="expansion-node-badge"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              )}

              {/* Status badge (top-right for blueprints) / Rank badge (top-left for talents) */}
              {isBlueprintNode ? (
                <img
                  src={isSkilled
                    ? resolveAppUrl('Exports/Icarus/Content/Assets/2DArt/UI/Tech_Tree/BlueprintCount_Unlocked_Normal.png')
                    : isAvailableUnskilled
                      ? resolveAppUrl('Exports/Icarus/Content/Assets/2DArt/UI/Tech_Tree/BlueprintCount_Available_Normal.png')
                      : resolveAppUrl('Exports/Icarus/Content/Assets/2DArt/UI/Tech_Tree/BlueprintCount_Locked_Normal.png')
                  }
                  alt={isSkilled ? '✓' : (isAvailableUnskilled ? '○' : '🔒')}
                  className="blueprint-status-badge"
                />
              ) : (
                <div className={`rank-badge ${isAvailableUnskilled ? 'available' : (isSkilled ? 'invested' : 'locked')}`}>{currentRank}/{maxRanks}</div>
              )}

              {/* Rank icon badge (top-right) – only for non-blueprint models */}
              {!isBlueprintNode && rankIconSrc && (
                <img
                  src={rankIconSrc}
                  alt=""
                  className="rank-icon-badge"
                  onError={(e) => {
                    e.target.style.display = 'none'
                  }}
                />
              )}

              {/* DLC requirement badge (bottom-left) */}
              {isBlueprintNode && hasDlcRequirement && dlcIconSrc && (
                <div className="dlc-node-badge">
                  <img src={dlcIconSrc} alt="DLC" className="dlc-node-badge-icon" />
                </div>
              )}

              {/* Mission / operation requirement badge (bottom-left, offset if DLC badge present) */}
              {isBlueprintNode && hasMissionRequirement && (
                <img
                  src={resolveAppUrl('Exports/Icarus/Content/Assets/2DArt/UI/Icons/T_Icon_Star.png')}
                  alt="★"
                  className={`mission-node-badge ${hasDlcRequirement ? 'with-dlc' : ''}`}
                />
              )}

              {/* Blueprint name label below the node */}
              {isBlueprintNode && (
                <div className="blueprint-node-label">
                  {resolveI18nText(talent.itemDetails?.display, localeStrings, null)
                    || resolveI18nText(talent.display, localeStrings, talent.id)}
                </div>
              )}

              {/* Tooltip */}
              {isHovered && (
                <TalentTooltip
                  talent={talent}
                  currentRank={currentRank}
                  localeStrings={localeStrings}
                  skilledTalents={skilledTalents}
                  mousePos={mousePos}
                  talentMap={visibleTalentMap}
                  modelId={modelId}
                  effectiveRequiredTalentIds={effectiveRequiredTalentIdsById[talent.id] ?? []}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function resolveEdgeMethod(drawMethod) {
  if (drawMethod === 'XThenY') {
    return 'YThenX'
  }

  if (drawMethod === 'YThenX') {
    return 'XThenY'
  }

  if (drawMethod === 'ShortestDistance') {
    return drawMethod
  }

  return DEFAULT_EDGE_METHOD
}

function buildEdgePath({ fromCenter, method, toCenter }) {
  const effectiveMethod = method ?? DEFAULT_EDGE_METHOD

  if (effectiveMethod === 'ShortestDistance') {
    return `M ${fromCenter.x} ${fromCenter.y} L ${toCenter.x} ${toCenter.y}`
  }

  if (effectiveMethod === 'XThenY') {
    return `M ${fromCenter.x} ${fromCenter.y} L ${toCenter.x} ${fromCenter.y} L ${toCenter.x} ${toCenter.y}`
  }

  return `M ${fromCenter.x} ${fromCenter.y} L ${fromCenter.x} ${toCenter.y} L ${toCenter.x} ${toCenter.y}`
}

function buildEdgePathWithWaypoints({ fromCenter, toCenter, waypoints, segmentMethods }) {
  const points = [...(waypoints ?? []), toCenter]
  let currentPoint = fromCenter

  return points
    .map((nextPoint, index) => {
      const method = segmentMethods?.[index] ?? DEFAULT_EDGE_METHOD
      const segmentPath = buildEdgePath({ fromCenter: currentPoint, method, toCenter: nextPoint })
      currentPoint = nextPoint
      return segmentPath
    })
    .join(' ')
}

function TalentTooltip({ talent, currentRank, localeStrings, skilledTalents, mousePos, talentMap, modelId, effectiveRequiredTalentIds }) {
  const tooltipRef = useRef(null)
  const isBlueprint = modelId === 'Blueprint'
  const title = resolveI18nText(talent.display, localeStrings, talent.id)
  const description = resolveI18nText(talent.description, localeStrings, '')
  const itemDetails = talent.itemDetails && typeof talent.itemDetails === 'object' ? talent.itemDetails : null
  const itemDisplayName = resolveI18nText(itemDetails?.display, localeStrings, '')
  const itemDescription = resolveI18nText(itemDetails?.description, localeStrings, '')
  const itemFlavor = resolveI18nText(itemDetails?.flavorText, localeStrings, '')

  const recipes = Array.isArray(itemDetails?.recipes) ? itemDetails.recipes : []
  const isMultiBlueprint = isBlueprint && recipes.length > 1
  const isSingleBlueprint = isBlueprint && recipes.length === 1

  // For blueprints: prefer the localized item name, fall back to talent display
  const blueprintTitle = isBlueprint
    ? (itemDisplayName || prettifyId(title))
    : prettifyId(title)

  // Armor stats summary: aggregate all armor stats across all recipes
  const hasAnyArmour = isBlueprint && recipes.some((r) => r.armourStats)
  const aggregatedArmourStats = hasAnyArmour ? aggregateArmourStats(recipes) : null

  const rewardRows = (talent.rewards ?? [])
    .map((reward, index) => {
      const rankNum = index + 1
      const isCurrentRank = rankNum === currentRank
      const effectValues = (reward.effects ?? [])
        .map((effect) => formatEffectLine(effect, localeStrings))
        .filter((line) => line && line.trim().length > 0)
        .join(', ')
        .trim()

      if (!effectValues) {
        return null
      }

      return {
        rankNum,
        isCurrentRank,
        effectValues
      }
    })
    .filter(Boolean)

  useEffect(() => {
    const node = tooltipRef.current
    if (!node) return

    const margin = 12
    const cursorOffset = 15
    let left = mousePos.x + cursorOffset
    let top = mousePos.y + cursorOffset

    const { width, height } = node.getBoundingClientRect()
    const maxLeft = window.innerWidth - width - margin
    const maxTop = window.innerHeight - height - margin

    left = Math.max(margin, Math.min(left, maxLeft))
    top = Math.max(margin, Math.min(top, maxTop))

    node.style.left = `${left}px`
    node.style.top = `${top}px`
  }, [mousePos])

  // ── Blueprint tooltip ──
  if (isBlueprint) {
    return (
      <div
        ref={tooltipRef}
        className="talent-tooltip-html blueprint-tooltip"
        style={{
          left: `${mousePos.x + 15}px`,
          top: `${mousePos.y + 15}px`
        }}
      >
        <div className="tooltip-header">
          <div className="tooltip-title">{blueprintTitle}</div>
        </div>

        {/* Description */}
        {isSingleBlueprint && itemDescription && (
          <div className="tooltip-description">{itemDescription}</div>
        )}
        {!isSingleBlueprint && description && (
          <div className="tooltip-description">{description}</div>
        )}

        {/* Flavor text */}
        {isSingleBlueprint && itemFlavor && (
          <div className="tooltip-flavor">{itemFlavor}</div>
        )}

        {/* Single item: crafted at + materials */}
        {isSingleBlueprint && (
          <BlueprintRecipeBlock recipe={recipes[0]} localeStrings={localeStrings} />
        )}

        {/* Multi-blueprint: list of unlocked blueprints with their recipes */}
        {isMultiBlueprint && (
          <div className="tooltip-blueprints">
            <div className="blueprints-header">Unlocks {recipes.length} Blueprints:</div>
            {recipes.map((recipe) => {
              const recipeName = resolveI18nText(recipe.display, localeStrings, prettifyId(recipe.id))
              return (
                <div key={recipe.id} className="blueprint-entry">
                  <div className="blueprint-entry-name">{recipeName}</div>
                  <BlueprintRecipeBlock recipe={recipe} localeStrings={localeStrings} compact />
                </div>
              )
            })}
          </div>
        )}

        {/* Armor stats summary */}
        {aggregatedArmourStats && (
          <div className="tooltip-armour-summary">
            <div className="armour-summary-header">Set Armor Stats (all pieces):</div>
            {aggregatedArmourStats.map(({ rawKey, total }) => {
              const { name, isPercent } = localizeStatName(rawKey, localeStrings)
              return (
                <div key={rawKey} className="armour-stat-row">
                  <span className="armour-stat-name">{name}</span>
                  <span className="armour-stat-value">{total > 0 ? '+' : ''}{total}{isPercent ? '%' : ''}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Other prerequisites: feature level, DLC, flags */}
        <BlueprintPrerequisites
          talent={talent}
          localeStrings={localeStrings}
          talentMap={talentMap}
          skilledTalents={skilledTalents}
          effectiveRequiredTalentIds={effectiveRequiredTalentIds}
        />
      </div>
    )
  }

  // ── Standard talent tooltip ──
  const itemCategories = Array.isArray(itemDetails?.categories) ? itemDetails.categories.filter(Boolean) : []
  const itemTags = Array.isArray(itemDetails?.tags) ? itemDetails.tags.filter(Boolean) : []
  const durable = itemDetails?.durable
  const buildable = itemDetails?.buildable
  const deployable = itemDetails?.deployable
  const consumable = itemDetails?.consumable
  const equippable = itemDetails?.equippable
  const usable = itemDetails?.usable

  return (
    <div 
      ref={tooltipRef}
      className="talent-tooltip-html"
      style={{
        left: `${mousePos.x + 15}px`,
        top: `${mousePos.y + 15}px`
      }}
    >
      <div className="tooltip-header">
        <div className="tooltip-title">{title}</div>
      </div>

      {description && <div className="tooltip-description">{description}</div>}

      {itemDetails && (
        <div className="tooltip-rewards">
          {itemDisplayName && itemDisplayName !== title && (
            <div className="reward-row">
              <span className="rank-label">Item:</span>
              <span className="rank-value">{itemDisplayName}</span>
            </div>
          )}
          {itemDescription && itemDescription !== description && (
            <div className="reward-row">
              <span className="rank-label">Details:</span>
              <span className="rank-value">{itemDescription}</span>
            </div>
          )}
          {itemFlavor && (
            <div className="reward-row">
              <span className="rank-label">Flavor:</span>
              <span className="rank-value">{itemFlavor}</span>
            </div>
          )}
          {itemCategories.length > 0 && (
            <div className="reward-row">
              <span className="rank-label">Categories:</span>
              <span className="rank-value">{itemCategories.join(', ')}</span>
            </div>
          )}
          {itemTags.length > 0 && (
            <div className="reward-row">
              <span className="rank-label">Tags:</span>
              <span className="rank-value">{itemTags.join(', ')}</span>
            </div>
          )}
          {Number.isFinite(Number(itemDetails?.weight)) && (
            <div className="reward-row">
              <span className="rank-label">Weight:</span>
              <span className="rank-value">{Number(itemDetails.weight)}</span>
            </div>
          )}
          {Number.isFinite(Number(itemDetails?.maxStack)) && (
            <div className="reward-row">
              <span className="rank-label">Max Stack:</span>
              <span className="rank-value">{Number(itemDetails.maxStack)}</span>
            </div>
          )}

          {durable && (
            <>
              <div className="reward-row">
                <span className="rank-label">Durability:</span>
                <span className="rank-value">
                  {formatList([
                    `Max ${Number.isFinite(Number(durable.maxDurability)) ? Number(durable.maxDurability) : 'n/a'}`,
                    durable.destroyedAtZero ? 'Destroyed at 0' : 'Repairable at 0'
                  ])}
                </span>
              </div>
              {Array.isArray(durable.repairItems) && durable.repairItems.length > 0 && (
                <div className="reward-row">
                  <span className="rank-label">Repair:</span>
                  <span className="rank-value">
                    {durable.repairItems
                      .map((entry) => {
                        const name = resolveI18nText(entry?.display, localeStrings, entry?.itemableId || entry?.staticItemId || '')
                        const amount = Number.isFinite(Number(entry?.amount)) ? Number(entry.amount) : null
                        return amount !== null ? `${amount}x ${name}` : name
                      })
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </div>
              )}
            </>
          )}

          {buildable && (
            <div className="reward-row">
              <span className="rank-label">Buildable:</span>
              <span className="rank-value">
                {formatList([
                  buildable.typeId ? `Type ${buildable.typeId}` : '',
                  buildable.pieceType ? `Piece ${buildable.pieceType}` : '',
                  Number.isFinite(Number(buildable.variationCount)) ? `Variations ${Number(buildable.variationCount)}` : '',
                  Number.isFinite(Number(buildable.talentGatedVariationCount))
                    ? `Talent-gated ${Number(buildable.talentGatedVariationCount)}`
                    : ''
                ])}
              </span>
            </div>
          )}

          {deployable && (
            <div className="reward-row">
              <span className="rank-label">Deployable:</span>
              <span className="rank-value">
                {formatList([
                  Number.isFinite(Number(deployable.variantCount)) ? `Variants ${Number(deployable.variantCount)}` : '',
                  deployable.affectedByWeather ? 'Affected by weather' : '',
                  deployable.mustBeOutside ? 'Must be outside' : '',
                  deployable.forceShowShelterIcon ? 'Shelter icon forced' : ''
                ])}
              </span>
            </div>
          )}

          {consumable && (
            <>
              {Object.keys(consumable.stats ?? {}).length > 0 && (
                <div className="reward-row">
                  <span className="rank-label">Consumable stats:</span>
                  <span className="rank-value">{formatStatMap(consumable.stats)}</span>
                </div>
              )}
              <div className="reward-row">
                <span className="rank-label">Consumable:</span>
                <span className="rank-value">
                  {formatList([
                    consumable.modifierId ? `Modifier ${consumable.modifierId}` : '',
                    Number.isFinite(Number(consumable.modifierLifetime)) ? `Duration ${Number(consumable.modifierLifetime)}` : '',
                    Array.isArray(consumable.byproducts) && consumable.byproducts.length > 0
                      ? `Byproducts ${consumable.byproducts.join(', ')}`
                      : ''
                  ])}
                </span>
              </div>
            </>
          )}

          {equippable && (
            <>
              {Object.keys(equippable.grantedStats ?? {}).length > 0 && (
                <div className="reward-row">
                  <span className="rank-label">Granted stats:</span>
                  <span className="rank-value">{formatStatMap(equippable.grantedStats)}</span>
                </div>
              )}
              {Object.keys(equippable.globalStats ?? {}).length > 0 && (
                <div className="reward-row">
                  <span className="rank-label">Global stats:</span>
                  <span className="rank-value">{formatStatMap(equippable.globalStats)}</span>
                </div>
              )}
              <div className="reward-row">
                <span className="rank-label">Equippable:</span>
                <span className="rank-value">
                  {formatList([
                    equippable.appliesInAllInventories ? 'Applies in all inventories' : '',
                    equippable.diminishingReturns ? 'Diminishing returns' : ''
                  ])}
                </span>
              </div>
            </>
          )}

          {usable && (
            <div className="reward-row">
              <span className="rank-label">Usable:</span>
              <span className="rank-value">
                {formatList([
                  Array.isArray(usable.uses) && usable.uses.length > 0 ? `Uses ${usable.uses.join(', ')}` : '',
                  usable.alwaysShowContextMenu ? 'Always show context menu' : ''
                ])}
              </span>
            </div>
          )}
        </div>
      )}

      {effectiveRequiredTalentIds?.length > 0 && (
        <div className="tooltip-prerequisites">
          <div className="label">Prerequisites (any one):</div>
          {effectiveRequiredTalentIds.map((reqId) => {
            const reqTalent = talentMap[reqId]
            const reqName = resolveI18nText(reqTalent?.display, localeStrings, reqId)
            const isMet = (skilledTalents?.[reqId] ?? 0) > 0
            return (
              <div key={reqId} className={`prerequisite ${isMet ? 'met' : 'unmet'}`}>
                {reqName}
              </div>
            )
          })}
        </div>
      )}

      {rewardRows.length ? (
        <div className="tooltip-rewards">
          {rewardRows.map(({ rankNum, isCurrentRank, effectValues }, index) => {
            return (
              <div key={`reward-${index}`} className={`reward-row ${isCurrentRank ? 'current-rank' : ''}`}>
                <span className="rank-label">Rank {rankNum}:</span>
                <span className="rank-value">{effectValues}</span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function BlueprintRecipeBlock({ recipe, localeStrings, compact = false }) {
  if (!recipe) return null

  const craftedAtNames = (recipe.craftedAt ?? [])
    .map((station) => resolveI18nText(station.display, localeStrings, prettifyId(station.id)))
    .filter(Boolean)

  const inputs = (recipe.inputs ?? []).map((input) => ({
    name: resolveI18nText(input.display, localeStrings, prettifyId(input.staticItemId)),
    count: input.count
  }))

  return (
    <div className={`blueprint-recipe ${compact ? 'compact' : ''}`}>
      {craftedAtNames.length > 0 && (
        <div className="recipe-crafted-at">
          <span className="recipe-label">Crafted at:</span>{' '}
          <span className="recipe-value">{craftedAtNames.join(', ')}</span>
        </div>
      )}
      {inputs.length > 0 && (
        <div className="recipe-materials">
          <span className="recipe-label">Materials:</span>
          <div className="recipe-material-list">
            {inputs.map((input, i) => (
              <span key={i} className="recipe-material">
                {input.count}× {input.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function prettifyId(text) {
  if (!text || typeof text !== 'string') return text ?? ''
  // If it looks like a proper display name (contains spaces or is NSLOCTEXT), return as-is
  if (text.includes(' ') || text.includes('NSLOCTEXT')) return text
  // Convert Foo_Bar_Baz → Foo Bar Baz
  return text.replace(/_/g, ' ')
}

function aggregateArmourStats(recipes) {
  const order = []
  const totals = {}
  for (const recipe of recipes) {
    if (!recipe.armourStats) continue
    for (const [rawKey, value] of Object.entries(recipe.armourStats)) {
      if (!(rawKey in totals)) {
        order.push(rawKey)
        totals[rawKey] = 0
      }
      totals[rawKey] += value
    }
  }
  if (order.length === 0) return null
  return order.map((rawKey) => ({ rawKey, total: totals[rawKey] }))
}

function localizeStatName(rawKey, localeStrings) {
  // rawKey is like '(Value="BasePhysicalDamageResistance_%")'
  const match = rawKey.match(/Value="([^"]+)"/)
  const statId = match ? match[1] : rawKey
  const isPercent = statId.includes('%')

  // Look up PositiveDescription → "+{0} Physical Resistance" or "+{0}% Cold Resistance"
  const template = localeStrings?.[`${statId}-PositiveDescription`]
    || localeStrings?.[`D_Stats:${statId}-PositiveDescription`]
    || ''

  if (template) {
    // Strip leading +/- and {0}/%  to get just the name
    const name = template.replace(/^[+-]?\{0\}%?\s*/, '').trim()
    if (name) return { name, isPercent }
  }

  // Fallback: strip Value wrapper, Base prefix, trailing _%, etc.
  const fallback = statId.replace(/[_]?[+-]?%?$/, '').replace(/^Base/, '')
  return { name: prettifyId(fallback), isPercent }
}

function BlueprintPrerequisites({ talent, localeStrings, talentMap, skilledTalents, effectiveRequiredTalentIds }) {
  const requiredFlags = Array.isArray(talent.requiredFlags) ? talent.requiredFlags : []
  const featureLevel = talent.requiredFeatureLevel

  const flagEntries = requiredFlags
    .filter((f) => f?.RowName && f.RowName !== 'None')
    .map((f) => {
      const table = f.DataTableName || ''
      const rowName = f.RowName
      if (table === 'D_DLCPackageData') {
        const dlcName = localeStrings?.[`${rowName}-DLCName`]
          || localeStrings?.[`D_DLCPackageData:${rowName}-DLCName`]
          || prettifyId(rowName)
        return { key: `dlc-${rowName}`, label: `Requires DLC: ${dlcName}`, type: 'dlc' }
      }
      if (table === 'D_CharacterFlags') {
        // Enriched: show which talent grants this flag
        if (f.grantedBy) {
          const talentName = resolveI18nText(f.grantedBy.display, localeStrings, null)
            || prettifyId(f.grantedBy.talentId)
          return { key: `flag-${rowName}`, label: `Requires Talent: ${prettifyId(talentName)}`, type: 'talent-flag' }
        }
        const desc = localeStrings?.[`${rowName}-Description`]
          || localeStrings?.[`D_CharacterFlags:${rowName}-Description`]
          || null
        return { key: `flag-${rowName}`, label: desc || `Mission: ${prettifyId(rowName)}`, type: 'mission' }
      }
      if (table === 'D_AccountFlags') {
        // Enriched: show the mission(s) that reward this flag
        const missions = Array.isArray(f.missions) ? f.missions : []
        if (missions.length > 0) {
          const missionLabels = missions.map((mId) => {
            const dropName = localeStrings?.[`${mId}-DropName`]
              || localeStrings?.[`D_ProspectList:${mId}-DropName`]
              || null
            const desc = localeStrings?.[`${mId}-Description`]
              || localeStrings?.[`D_ProspectList:${mId}-Description`]
              || null
            if (dropName && desc) return `${dropName} — ${desc}`
            if (dropName) return dropName
            if (desc) return desc
            return prettifyId(mId)
          })
          return { key: `acct-${rowName}`, label: `Mission: ${missionLabels.join(', ')}`, type: 'account' }
        }
        const clean = rowName.replace(/^GrantedBlueprint_/, '').replace(/^GrantedTalent_/, '')
        return { key: `acct-${rowName}`, label: `Unlocked: ${prettifyId(clean)}`, type: 'account' }
      }
      return { key: `flag-${rowName}`, label: prettifyId(rowName), type: 'unknown' }
    })

  let featureEntry = null
  if (featureLevel) {
    const dlcName = localeStrings?.[`${featureLevel}-DLCName`]
      || localeStrings?.[`D_DLCPackageData:${featureLevel}-DLCName`]
      || null
    // Try underscore-separated variant (DangerousHorizons → Dangerous_Horizons)
    const underscored = featureLevel.replace(/([a-z])([A-Z])/g, '$1_$2')
    const dlcNameAlt = !dlcName
      ? (localeStrings?.[`${underscored}-DLCName`]
        || localeStrings?.[`D_DLCPackageData:${underscored}-DLCName`]
        || null)
      : null
    const displayName = dlcName || dlcNameAlt || prettifyId(featureLevel)
    featureEntry = { key: `feat-${featureLevel}`, label: `Added in: ${displayName}`, type: 'expansion' }
  }

  const hasPrereqs = effectiveRequiredTalentIds?.length > 0 || flagEntries.length > 0 || featureEntry
  if (!hasPrereqs) return null

  return (
    <div className="tooltip-prerequisites">
      {featureEntry && (
        <div className="prerequisite expansion">{featureEntry.label}</div>
      )}
      {flagEntries.map((entry) => (
        <div key={entry.key} className={`prerequisite ${entry.type}`}>{entry.label}</div>
      ))}
      {effectiveRequiredTalentIds?.length > 0 && (
        <>
          <div className="label">Prerequisites (any one):</div>
          {effectiveRequiredTalentIds.map((reqId) => {
            const reqTalent = talentMap[reqId]
            const reqName = resolveI18nText(reqTalent?.itemDetails?.display, localeStrings, null)
              || resolveI18nText(reqTalent?.display, localeStrings, reqId)
            const isMet = (skilledTalents?.[reqId] ?? 0) > 0
            return (
              <div key={reqId} className={`prerequisite ${isMet ? 'met' : 'unmet'}`}>
                {prettifyId(reqName)}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

function formatList(values) {
  const normalized = Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim()) : []
  return normalized.join(' • ')
}

function formatStatMap(statsMap) {
  if (!statsMap || typeof statsMap !== 'object') {
    return ''
  }

  return Object.entries(statsMap)
    .map(([key, value]) => {
      const numericValue = Number(value)
      if (!Number.isFinite(numericValue)) {
        return null
      }

      const prefix = numericValue > 0 ? '+' : ''
      return `${key}: ${prefix}${numericValue}`
    })
    .filter(Boolean)
    .join(', ')
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

function resolveEffectiveRequirements(requiredTalents, talentMap) {
  if (!Array.isArray(requiredTalents) || requiredTalents.length === 0) {
    return []
  }

  const resolved = []
  const seen = new Set()

  requiredTalents.forEach((requiredTalentId) => {
    const expandedRequirements = expandRequiredTalentRequirement(requiredTalentId, talentMap, new Set(), [])
    expandedRequirements.forEach((expandedRequirement) => {
      const key = `${expandedRequirement.targetId}|${expandedRequirement.viaTalentIds.join('>')}`
      if (seen.has(key)) {
        return
      }

      seen.add(key)
      resolved.push(expandedRequirement)
    })
  })

  return resolved
}

function expandRequiredTalentRequirement(requiredTalentId, talentMap, visiting, viaTalentIds) {
  if (!requiredTalentId || visiting.has(requiredTalentId)) {
    return []
  }

  const requiredTalent = talentMap?.[requiredTalentId]
  if (!requiredTalent || !shouldHideTalent(requiredTalent)) {
    return [{ targetId: requiredTalentId, viaTalentIds }]
  }

  const nestedRequiredTalents = requiredTalent.requiredTalents ?? []
  if (nestedRequiredTalents.length === 0) {
    return []
  }

  visiting.add(requiredTalentId)
  const nextViaTalentIds = [...viaTalentIds, requiredTalentId]
  const nested = nestedRequiredTalents.flatMap((nestedId) => {
    return expandRequiredTalentRequirement(nestedId, talentMap, visiting, nextViaTalentIds)
  })
  visiting.delete(requiredTalentId)

  return nested
}

function uniqueValues(values) {
  return Array.from(new Set(values))
}

function formatEffectLine(effect, localeStrings) {
  if (!effect) return ''

  const template = resolveEffectTemplate(effect, localeStrings)
  if (template) {
    return template.replace(/\{0\}/g, formatTemplateValue(effect.value, template))
  }

  return formatEffectValue(extractStatId(effect), effect.value)
}

function formatTemplateValue(value, template) {
  if (value === null || value === undefined) return ''
  const num = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(num)) return String(value)

  const hasExplicitSignInTemplate = /[+-]\s*\{0\}/.test(template)
  if (hasExplicitSignInTemplate) {
    return `${Math.abs(num)}`
  }

  return `${num}`
}

function resolveEffectTemplate(effect, localeStrings) {
  if (!localeStrings) return ''

  const statId = extractStatId(effect)
  if (!statId) return ''

  const keys = {
    positiveDescriptionKey: `${statId}-PositiveDescription`,
    negativeDescriptionKey: `${statId}-NegativeDescription`,
    titleKey: `${statId}-Title`
  }

  const preferredKey = effect.value >= 0 ? keys.positiveDescriptionKey : keys.negativeDescriptionKey
  const fallbackKey = effect.value >= 0 ? keys.negativeDescriptionKey : keys.positiveDescriptionKey

  return (
    localeStrings[preferredKey]
    || localeStrings[fallbackKey]
    || localeStrings[keys.titleKey]
    || ''
  )
}

function resolveI18nText(i18nValue, localeStrings, fallbackText = '') {
  if (typeof i18nValue === 'string') {
    const parsed = parseNsLoc(i18nValue)
    if (!parsed) {
      return i18nValue || fallbackText
    }

    const scopedKey = `${parsed.category}:${parsed.key}`
    return localeStrings?.[scopedKey] || localeStrings?.[parsed.key] || parsed.text || fallbackText
  }

  if (!i18nValue || typeof i18nValue !== 'object') {
    return fallbackText
  }

  const scopedKey = i18nValue.category && i18nValue.key
    ? `${i18nValue.category}:${i18nValue.key}`
    : null

  return (
    (scopedKey && localeStrings?.[scopedKey])
    || (i18nValue.key && localeStrings?.[i18nValue.key])
    || i18nValue.text
    || fallbackText
  )
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

function extractStatId(effect) {
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

function formatEffectValue(statId, value) {
  // Extract the suffix from statId (e.g., _+%, _%, _+)
  const suffixMatch = statId.match(/_([+-]?)(%?)$/)
  
  let formattedValue = String(value)
  
  if (suffixMatch) {
    const sign = suffixMatch[1] // + or - or empty
    const isPercent = suffixMatch[2] === '%'
    
    // Add sign if value is positive
    if (value > 0 && sign === '+') {
      formattedValue = '+' + value
    } else if (value > 0) {
      formattedValue = '+' + value
    }
    
    // Add percent if suffix indicates it
    if (isPercent) {
      formattedValue += '%'
    }
  } else {
    // No special suffix, just show the value with + for positive
    if (value > 0) {
      formattedValue = '+' + value
    }
  }
  
  return formattedValue
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

export default TalentTreeCanvas
