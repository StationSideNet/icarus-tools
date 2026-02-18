import { useEffect, useMemo, useRef, useState } from 'react'
import './TalentTreeCanvas.css'

const NODE_SCALE = 0.5
const DEFAULT_EDGE_METHOD = 'YThenX'

const scaleValue = (value) => value * NODE_SCALE

function TalentTreeCanvas({ tree, ranks, modelId, localeStrings, skillInvestments, skilledTalents, onSkillTalent, treePoints }) {
  const [hoveredTalentId, setHoveredTalentId] = useState(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const showRankProgressBars = modelId !== 'Creature'
  const talentMap = tree?.talents ?? {}

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

function TalentTooltip({ talent, currentRank, localeStrings, skilledTalents, mousePos, talentMap, effectiveRequiredTalentIds }) {
  const tooltipRef = useRef(null)
  const title = resolveI18nText(talent.display, localeStrings, talent.id)
  const description = resolveI18nText(talent.description, localeStrings, '')
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

  return `/Exports/Icarus/Content/${packagePath}.png`
}

export default TalentTreeCanvas
