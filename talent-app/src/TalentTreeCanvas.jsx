import { useEffect, useMemo, useRef, useState } from 'react'
import './TalentTreeCanvas.css'
import { resolveAppUrl, resolveAssetImagePath, resolveLocalizedValue, prettifyId, uniqueValues } from './utils.js'
import { getTalentRankCount, shouldHideTalent, resolveEffectiveRequirements } from './talentUtils.js'
import { resolveEdgeMethod, buildEdgePath, buildEdgePathWithWaypoints } from './edgeRouting.js'
import TalentTooltip from './TalentTooltip.jsx'

const NODE_SCALE = 0.5

const scaleValue = (value) => value * NODE_SCALE

function TalentTreeCanvas({ tree, ranks, modelId, localeStrings, skillInvestments, skilledTalents, onSkillTalent, treePoints }) {
  const [hoveredTalentId, setHoveredTalentId] = useState(null)
  const [hoveredBadgeId, setHoveredBadgeId] = useState(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const isBlueprint = modelId === 'Blueprint'
  const showTreeHeader = !isBlueprint
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
      const cx = scaleValue(talent.position?.x ?? 0)
      const cy = scaleValue(talent.position?.y ?? 0)
      const hw = scaleValue(talent.size?.x ?? 128) / 2
      const hh = scaleValue(talent.size?.y ?? 128) / 2

      minX = Math.min(minX, cx - hw)
      minY = Math.min(minY, cy - hh)
      maxX = Math.max(maxX, cx + hw)
      maxY = Math.max(maxY, cy + hh)
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
  const currentRankLabel = resolveLocalizedValue(
    ranks?.[rankInfo.currentRank]?.display,
    localeStrings,
    rankInfo.currentRank
  )
  const nextRankLabel = rankInfo.nextRank
    ? resolveLocalizedValue(ranks?.[rankInfo.nextRank]?.display, localeStrings, rankInfo.nextRank)
    : null
  const treeTitle = resolveLocalizedValue(tree?.display, localeStrings, tree?.id ?? '')
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

    // Player_Crafting in blueprints is always skilled and cannot be removed
    if (isBlueprint && talentId === 'Player_Crafting') return

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
    <div className={`talent-tree-canvas-container ${showTreeHeader ? '' : 'no-header'}`.trim()}>
      {/* Tree mastery progress – hidden for blueprints (no ranks) */}
      {showTreeHeader && (
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
          {modelId !== 'Creature' && (
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
          {modelId !== 'Creature' && (
            <div className="tree-progress-bar-bg">
              <div
                className="tree-progress-bar-fill"
                style={{ width: `${Math.min(100, rankInfo.nextThreshold > 0 ? (treePoints / rankInfo.nextThreshold) * 100 : 0)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* SVG + HTML nodes share the same wrapper so edges and nodes align */}
      <div className="talent-tree-layer" style={{ width: bounds.width, height: bounds.height, position: 'relative' }}>
        <svg
          className="talent-tree-edges"
          width={bounds.width}
          height={bounds.height}
        >
        <g className="edges">
          {talents.map((talent) => {
            const fromCenter = worldToContainer(
              talent.position?.x ?? 0,
              talent.position?.y ?? 0
            )

            const requirements = effectiveRequirementsByTalentId[talent.id] ?? []

            return requirements.map((requirement) => {
              const reqId = requirement.targetId
              const required = visibleTalentMap[reqId]
              if (!required) return null

              const toCenter = worldToContainer(
                required.position?.x ?? 0,
                required.position?.y ?? 0
              )

              const isHovered = hoveredTalentId === talent.id || hoveredTalentId === reqId
              const isRequirementFulfilled = (skilledTalents[reqId] ?? 0) > 0
              const viaTalents = requirement.viaTalentIds
                .map((viaTalentId) => talentMap[viaTalentId])
                .filter(Boolean)

              const waypoints = viaTalents.map((viaTalent) => {
                return worldToContainer(viaTalent.position?.x ?? 0, viaTalent.position?.y ?? 0)
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
        <div className="talent-nodes-container" style={{ width: bounds.width, height: bounds.height, position: 'absolute', top: 0, left: 0 }}>
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
          const isBlueprintNode = isBlueprint

          // Get Master rank icon for talent requirement badges
          const masterRankIconSrc = resolveAssetImagePath(ranks?.Master?.icon)

          // Determine prerequisite badge flags for blueprint nodes
          const requiredFlags = Array.isArray(talent.requiredFlags) ? talent.requiredFlags : []
          const dlcFlag = requiredFlags.find((f) => f?.DataTableName === 'D_DLCPackageData')
          const hasDlcRequirement = !!dlcFlag
          const missionFlags = requiredFlags.filter((f) =>
            f?.DataTableName === 'D_AccountFlags'
          )
          const hasMissionRequirement = missionFlags.length > 0
          const talentGrantFlags = requiredFlags.filter((f) =>
            f?.DataTableName === 'D_CharacterFlags' && f?.grantedBy
          )
          const hasTalentGrantRequirement = talentGrantFlags.length > 0
          const featureLevelIconSrc = isBlueprintNode ? resolveAssetImagePath(talent.featureLevelIcon) : null
          const dlcIconSrc = dlcFlag?.dlcIcon ? resolveAssetImagePath(dlcFlag.dlcIcon) : null

          // Count unlocked items/recipes (for bottom-right badge)
          const unlockedCount = isBlueprintNode && Array.isArray(talent.itemDetails?.recipes)
            ? talent.itemDetails.recipes.length
            : 0

          // Badge tooltip labels – use game localization templates where available
          const requiresTemplate = localeStrings?.['ST_UMG:Requires'] || localeStrings?.['Requires'] || 'Requires [{0}]'
          const requiresDlcTemplate = localeStrings?.['ST_Quests:RequiresDLC'] || localeStrings?.['RequiresDLC'] || 'Requires [{0}] DLC'
          const grantedByTalentLabel = localeStrings?.['GrantedByTalent'] || 'Granted by Talent'

          const dlcBadgeLabel = dlcFlag
            ? requiresDlcTemplate.replace(
                /\[\{0\}]/g,
                localeStrings?.[`${dlcFlag.RowName}-DLCName`]
                  || localeStrings?.[`D_DLCPackageData:${dlcFlag.RowName}-DLCName`]
                  || prettifyId(dlcFlag.RowName)
              )
            : null

          // Mission badge labels
          const missionBadgeLabels = missionFlags.map((f) => {
            const missions = Array.isArray(f.missions) ? f.missions : []
            if (missions.length > 0) {
              const texts = missions.map((mId) => {
                const dropName = localeStrings?.[`${mId}-DropName`]
                  || localeStrings?.[`D_ProspectList:${mId}-DropName`]
                  || null
                const desc = localeStrings?.[`${mId}-Description`]
                  || localeStrings?.[`D_ProspectList:${mId}-Description`]
                  || null
                if (dropName && desc) return `${dropName} \u2014 ${desc}`
                if (dropName) return dropName
                if (desc) return desc
                return prettifyId(mId)
              })
              return requiresTemplate.replace(/\[\{0\}]/g, texts.join(', '))
            }
            const clean = f.RowName.replace(/^GrantedBlueprint_/, '').replace(/^GrantedTalent_/, '')
            return requiresTemplate.replace(/\[\{0\}]/g, prettifyId(clean))
          }).filter(Boolean)

          // Talent grant badge labels
          const talentGrantBadgeLabels = talentGrantFlags.map((f) => {
            const tName = resolveLocalizedValue(f.grantedBy.display, localeStrings, null) || prettifyId(f.grantedBy.talentId)
            return `${grantedByTalentLabel}: ${prettifyId(tName)}`
          }).filter(Boolean)

          return (
            <div
              key={talent.id}
              className={`talent-node ${isHovered ? 'hovered' : ''} ${isDisabled ? 'disabled' : ''} ${isAvailableUnskilled ? 'available-unskilled' : ''} ${isSkilled ? 'skilled' : ''}`}
              style={{
                left: `${pos.x - w / 2}px`,
                top: `${pos.y - h / 2}px`,
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
              {!isBlueprint && modelId !== 'Creature' && (
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
                    ? resolveAppUrl('Assets/Icarus/Content/Assets/2DArt/UI/Tech_Tree/BlueprintCount_Unlocked_Normal.png')
                    : isAvailableUnskilled
                      ? resolveAppUrl('Assets/Icarus/Content/Assets/2DArt/UI/Tech_Tree/BlueprintCount_Available_Normal.png')
                      : resolveAppUrl('Assets/Icarus/Content/Assets/2DArt/UI/Tech_Tree/BlueprintCount_Locked_Normal.png')
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
                <div
                  className="dlc-node-badge"
                  onMouseEnter={(e) => { e.stopPropagation(); setHoveredBadgeId(`dlc-${talent.id}`) }}
                  onMouseLeave={() => setHoveredBadgeId(null)}
                >
                  <img src={dlcIconSrc} alt="DLC" className="dlc-node-badge-icon" />
                  {hoveredBadgeId === `dlc-${talent.id}` && dlcBadgeLabel && (
                    <div className="badge-tooltip">{dlcBadgeLabel}</div>
                  )}
                </div>
              )}

              {/* Mission requirement badge (bottom-left) */}
              {isBlueprintNode && hasMissionRequirement && (
                <div
                  className={`mission-node-badge ${hasDlcRequirement || hasTalentGrantRequirement ? 'with-dlc' : ''} ${hasTalentGrantRequirement ? 'with-talent-grant' : ''}`}
                  onMouseEnter={(e) => { e.stopPropagation(); setHoveredBadgeId(`mission-${talent.id}`) }}
                  onMouseLeave={() => setHoveredBadgeId(null)}
                >
                  <img
                    src={resolveAppUrl('Assets/Icarus/Content/Assets/2DArt/UI/Icons/T_Icon_Star.png')}
                    alt="★"
                    className="mission-node-badge-icon"
                  />
                  {hoveredBadgeId === `mission-${talent.id}` && missionBadgeLabels.length > 0 && (
                    <div className="badge-tooltip">
                      {missionBadgeLabels.map((label, i) => <div key={i}>{label}</div>)}
                    </div>
                  )}
                </div>
              )}

              {/* Talent grant requirement badge (bottom-left, offset if DLC badge present) */}
              {isBlueprintNode && hasTalentGrantRequirement && masterRankIconSrc && (
                <div
                  className={`talent-grant-node-badge ${hasDlcRequirement ? 'with-dlc' : ''}`}
                  onMouseEnter={(e) => { e.stopPropagation(); setHoveredBadgeId(`talent-grant-${talent.id}`) }}
                  onMouseLeave={() => setHoveredBadgeId(null)}
                >
                  <img
                    src={masterRankIconSrc}
                    alt="◆"
                    className="talent-grant-node-badge-icon"
                  />
                  {hoveredBadgeId === `talent-grant-${talent.id}` && talentGrantBadgeLabels.length > 0 && (
                    <div className="badge-tooltip">
                      {talentGrantBadgeLabels.map((label, i) => <div key={i}>{label}</div>)}
                    </div>
                  )}
                </div>
              )}

              {/* Unlock count badge (bottom-right) – shows how many items/blueprints are unlocked */}
              {isBlueprintNode && unlockedCount > 1 && (
                <div className="unlock-count-badge" title={`Unlocks ${unlockedCount} items`}>
                  {unlockedCount}
                </div>
              )}

              {/* Blueprint name label below the node */}
              {isBlueprintNode && (
                <div className="blueprint-node-label">
                  {resolveLocalizedValue(talent.itemDetails?.display, localeStrings, null)
                    || resolveLocalizedValue(talent.display, localeStrings, talent.id)}
                </div>
              )}

              {/* Tooltip (suppressed when a badge tooltip is active) */}
              {isHovered && !hoveredBadgeId && (
                <TalentTooltip
                  talent={talent}
                  currentRank={currentRank}
                  localeStrings={localeStrings}
                  skilledTalents={skilledTalents}
                  mousePos={mousePos}
                  talentMap={visibleTalentMap}
                  modelId={modelId}
                />
              )}
            </div>
          )
        })}
        </div>
      </div>
    </div>
  )
}


export default TalentTreeCanvas
