import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '..', '..')
const appRoot = path.join(workspaceRoot, 'talent-app')

const publicRoot = path.join(appRoot, 'public')
const dataFilePath = path.join(publicRoot, 'Data', 'talents.json')
const exportsRootPath = path.join(publicRoot, 'Exports')
const exportsContentPath = path.join(exportsRootPath, 'Icarus', 'Content')
const localizationRootPath = path.join(exportsContentPath, 'Localization', 'Game')
const localizationManifestPath = path.join(localizationRootPath, 'Game.json')

async function pathExists(targetPath) {
  try {
    await fs.lstat(targetPath)
    return true
  } catch {
    return false
  }
}

function addUnrealPath(out, value) {
  if (typeof value === 'string' && value.startsWith('/Game/')) {
    out.add(value)
  }
}

function collectRuntimeAssetPaths(dataJson) {
  const out = new Set()

  Object.values(dataJson?.ranks ?? {}).forEach((rank) => {
    addUnrealPath(out, rank?.icon)
  })

  Object.values(dataJson?.models ?? {}).forEach((model) => {
    Object.values(model?.archetypes ?? {}).forEach((archetype) => {
      addUnrealPath(out, archetype?.icon)
      addUnrealPath(out, archetype?.background)

      Object.values(archetype?.trees ?? {}).forEach((tree) => {
        addUnrealPath(out, tree?.icon)
        addUnrealPath(out, tree?.background)

        Object.values(tree?.talents ?? {}).forEach((talent) => {
          addUnrealPath(out, talent?.icon)
        })
      })
    })
  })

  return [...out]
}

function unrealToPngAbsolutePath(unrealPath) {
  if (!unrealPath.startsWith('/Game/')) {
    return null
  }

  const pathWithoutPrefix = unrealPath.slice('/Game/'.length)
  const packagePath = pathWithoutPrefix.split('.')[0]
  if (!packagePath) {
    return null
  }

  return path.join(exportsContentPath, `${packagePath}.png`)
}

function isCriticalAssetPath(unrealPath) {
  return unrealPath.includes('/Assets/2DArt/UI/Talents/')
}

async function main() {
  const failures = []

  if (!(await pathExists(dataFilePath))) {
    failures.push(`Missing canonical data file: ${dataFilePath}`)
  }

  if (!(await pathExists(exportsRootPath))) {
    failures.push(`Missing Exports root in public: ${exportsRootPath}`)
  }

  if (!(await pathExists(localizationManifestPath))) {
    failures.push(`Missing localization manifest: ${localizationManifestPath}`)
  }

  if (failures.length > 0) {
    console.error('Path preflight failed. Missing required files/directories:')
    failures.forEach((failure) => console.error(`- ${failure}`))
    console.error('Regenerate transformed data and copied Exports subset before running the app.')
    process.exitCode = 1
    return
  }

  const dataRaw = await fs.readFile(dataFilePath, 'utf8')
  let dataJson = null
  try {
    dataJson = JSON.parse(dataRaw)
  } catch {
    console.error(`Path preflight failed. Invalid JSON: ${dataFilePath}`)
    process.exitCode = 1
    return
  }

  if (!dataJson?.models || !dataJson?.ranks) {
    console.error('Path preflight failed. talents.json is missing required top-level keys: models/ranks.')
    process.exitCode = 1
    return
  }

  const manifestRaw = await fs.readFile(localizationManifestPath, 'utf8')
  let manifestJson = null
  try {
    manifestJson = JSON.parse(manifestRaw)
  } catch {
    console.error(`Path preflight failed. Invalid JSON: ${localizationManifestPath}`)
    process.exitCode = 1
    return
  }

  const localeCodes = Array.from(new Set([
    'en',
    manifestJson?.NativeCulture,
    ...(Array.isArray(manifestJson?.CompiledCultures) ? manifestJson.CompiledCultures : [])
  ].filter(Boolean)))

  const missingLocaleFiles = []
  for (const localeCode of localeCodes) {
    const localeFilePath = path.join(localizationRootPath, localeCode, 'Game.json')
    if (!(await pathExists(localeFilePath))) {
      missingLocaleFiles.push(localeFilePath)
    }
  }

  if (missingLocaleFiles.length > 0) {
    console.error('Path preflight failed. Missing locale files:')
    missingLocaleFiles.forEach((missingPath) => console.error(`- ${missingPath}`))
    process.exitCode = 1
    return
  }

  const referencedAssets = collectRuntimeAssetPaths(dataJson)
  const uniqueAssets = Array.from(new Set(referencedAssets)).map((unrealPath) => ({
    unrealPath,
    absolutePath: unrealToPngAbsolutePath(unrealPath),
    critical: isCriticalAssetPath(unrealPath)
  })).filter((entry) => entry.absolutePath)

  const missingCriticalAssets = []
  const missingOptionalAssets = []

  for (const asset of uniqueAssets) {
    if (await pathExists(asset.absolutePath)) {
      continue
    }

    if (asset.critical) {
      missingCriticalAssets.push(asset.absolutePath)
    } else {
      missingOptionalAssets.push(asset.absolutePath)
    }
  }

  if (missingCriticalAssets.length > 0) {
    console.error('Path preflight failed. Missing critical talent assets referenced by talents.json:')
    missingCriticalAssets.slice(0, 25).forEach((missingPath) => console.error(`- ${missingPath}`))
    if (missingCriticalAssets.length > 25) {
      console.error(`... and ${missingCriticalAssets.length - 25} more`)
    }
    process.exitCode = 1
    return
  }

  if (missingOptionalAssets.length > 0) {
    console.warn(`Path preflight warning. Missing non-critical referenced assets: ${missingOptionalAssets.length}`)
  }

  console.log('Path preflight passed.')
  console.log(`Locales verified: ${localeCodes.length}`)
  console.log(`Asset references verified: ${uniqueAssets.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
