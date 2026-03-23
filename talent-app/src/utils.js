/**
 * Shared generic utilities used across the talent viewer.
 */

export const resolveAppUrl = (relativePath) => new URL(relativePath, document.baseURI).toString()

export function parseNsLoc(value) {
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

export function resolveAssetImagePath(unrealPath, selectedVersionId, versionsIndex) {
  if (!unrealPath || typeof unrealPath !== 'string' || !unrealPath.startsWith('/Game/')) {
    return null
  }

  const pathWithoutPrefix = unrealPath.slice('/Game/'.length)
  const packagePath = pathWithoutPrefix.split('.')[0]

  if (!packagePath) {
    return null
  }

  const relPath = `Icarus/Content/${packagePath}.png`

  // Archive-aware resolution: find the correct version's asset
  if (selectedVersionId && versionsIndex?.versions?.length) {
    const versions = versionsIndex.versions
    const selectedIndex = versions.findIndex((v) => v.id === selectedVersionId)
    if (selectedIndex >= 0) {
      // Walk versions from newest down to selectedVersion looking for an archive entry
      // An entry in archivedAssets on version V means the file was archived under the
      // PREVIOUS version's archive dir before V was written (i.e. the pre-V copy)
      for (let i = 0; i < selectedIndex; i++) {
        const v = versions[i]
        if (Array.isArray(v.assets?.archivedAssets) && v.assets.archivedAssets.includes(relPath)) {
          // The asset changed going into version v — so for versions older than v, serve archive
          const archiveVersionId = versions[i + 1]?.id
          if (archiveVersionId) {
            return resolveAppUrl(`Assets/Archive/${archiveVersionId}/${relPath}`)
          }
        }
      }
    }
  }

  return resolveAppUrl(`Assets/${relPath}`)
}

export function resolveLocalizedValue(value, localeStrings, fallbackText = '') {
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

export function extractModifierId(effect) {
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

export function prettifyId(text) {
  if (!text || typeof text !== 'string') return text ?? ''
  // If it looks like a proper display name (contains spaces or is NSLOCTEXT), return as-is
  if (text.includes(' ') || text.includes('NSLOCTEXT')) return text
  // Convert Foo_Bar_Baz → Foo Bar Baz
  return text.replace(/_/g, ' ')
}

export function formatList(values) {
  const normalized = Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim()) : []
  return normalized.join(' • ')
}

export function uniqueValues(values) {
  return Array.from(new Set(values))
}

export function areStringArraysEqual(left, right) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

export function flattenLocalizationByKey(localeJson) {
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
