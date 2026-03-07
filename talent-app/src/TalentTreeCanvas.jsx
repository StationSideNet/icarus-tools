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
              const waypoints = requirement.viaTalentIds
                .map((viaTalentId) => talentMap[viaTalentId])
                .filter(Boolean)
                .map((viaTalent) => {
                  const viaPos = worldToContainer(viaTalent.position?.x ?? 0, viaTalent.position?.y ?? 0)
                  return {
                    x: viaPos.x + scaleValue(viaTalent.size?.x ?? 128) / 2,
                    y: viaPos.y + scaleValue(viaTalent.size?.y ?? 128) / 2
                  }
                })

              const edgePath = buildEdgePathWithWaypoints({
                fromCenter,
                toCenter,
                waypoints,
                method: resolveEdgeMethod(talent.drawMethod)
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

              {/* Rank badge (top-left) */}
              <div className={`rank-badge ${isAvailableUnskilled ? 'available' : (isSkilled ? 'invested' : 'locked')}`}>{currentRank}/{maxRanks}</div>

              {/* Rank icon badge (top-right) */}
              {rankIconSrc && (
                <img
                  src={rankIconSrc}
                  alt=""
                  className="rank-icon-badge"
                  onError={(e) => {
                    e.target.style.display = 'none'
                  }}
                />
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

function buildEdgePathWithWaypoints({ fromCenter, method, toCenter, waypoints }) {
  const points = [...(waypoints ?? []), toCenter]
  let currentPoint = fromCenter

  return points
    .map((nextPoint) => {
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

  // For blueprints: the display name should be the item name (properly resolved)
  // For single-item: use itemDisplayName, for multi: use talent display name
  const blueprintTitle = isSingleBlueprint
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
            {Object.entries(aggregatedArmourStats).map(([statName, value]) => (
              <div key={statName} className="armour-stat-row">
                <span className="armour-stat-name">{statName}</span>
                <span className="armour-stat-value">{value > 0 ? '+' : ''}{value}{statName.includes('%') ? '%' : ''}</span>
              </div>
            ))}
          </div>
        )}

        {/* Prerequisites */}
        {effectiveRequiredTalentIds?.length > 0 && (
          <div className="tooltip-prerequisites">
            <div className="label">Prerequisites (any one):</div>
            {effectiveRequiredTalentIds.map((reqId) => {
              const reqTalent = talentMap[reqId]
              const reqName = resolveI18nText(reqTalent?.display, localeStrings, reqId)
              const isMet = (skilledTalents?.[reqId] ?? 0) > 0
              return (
                <div key={reqId} className={`prerequisite ${isMet ? 'met' : 'unmet'}`}>
                  {prettifyId(reqName)}
                </div>
              )
            })}
          </div>
        )}
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

function cleanStatName(rawKey) {
  // Parse "(Value=\"BaseFoo_%\")" → "BaseFoo"
  const match = rawKey.match(/Value="([^"]+)"/)
  const statId = match ? match[1] : rawKey
  // Strip trailing _%, _+%, etc.
  return statId.replace(/[_]?[+-]?%?$/, '').replace(/^Base/, '')
}

function aggregateArmourStats(recipes) {
  const totals = {}
  const nameMap = {}
  for (const recipe of recipes) {
    if (!recipe.armourStats) continue
    for (const [rawKey, value] of Object.entries(recipe.armourStats)) {
      const cleanName = cleanStatName(rawKey)
      if (!nameMap[cleanName]) {
        nameMap[cleanName] = rawKey
        totals[cleanName] = 0
      }
      totals[cleanName] += value
    }
  }
  return Object.keys(totals).length > 0 ? totals : null
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

  const match = value.match(/NSLOCTEXT\("([^"]+)",\s*"([^"]+)",\s*"([^"]*)"\)/)
  if (!match) {
    return null
  }

  return {
    category: match[1],
    key: match[2],
    text: match[3]
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
