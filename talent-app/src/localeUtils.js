import { MODIFIER_LABELS_URL, DEFAULT_LOCALE, LOCALE_COOKIE_NAME } from './constants.js'
import { flattenLocalizationByKey } from './utils.js'

export function getLocaleLabel(localeCode) {
  try {
    const display = new Intl.DisplayNames([localeCode], { type: 'language' })
    const label = display.of(localeCode)
    return label ? normalizeLocaleLabel(label) : localeCode
  } catch {
    return localeCode
  }
}

export function normalizeLocaleLabel(label) {
  if (!label || typeof label !== 'string') {
    return label
  }

  return label.replace(/^\p{Ll}/u, (character) => character.toLocaleUpperCase())
}

export function getSavedLocaleFromCookie() {
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

export function setLocaleCookie(localeCode) {
  if (typeof document === 'undefined') {
    return
  }

  const maxAgeSeconds = 60 * 60 * 24 * 365
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(localeCode)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`
}

export async function fetchLocaleStrings(localeCode, localeBaseUrl) {
  const response = await fetch(`${localeBaseUrl}/${localeCode}/Game.json`)
  if (!response.ok) {
    return null
  }

  const json = await response.json()
  return flattenLocalizationByKey(json)
}

export async function fetchModifierLabels() {
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

export async function fetchLocaleManifest(localeConfigUrl) {
  const response = await fetch(localeConfigUrl)
  if (!response.ok) {
    return null
  }

  const json = await response.json()
  return {
    nativeCulture: json.NativeCulture || DEFAULT_LOCALE,
    compiledCultures: Array.isArray(json.CompiledCultures) ? json.CompiledCultures : []
  }
}
