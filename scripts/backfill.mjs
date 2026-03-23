/**
 * Depot backfill script for icarus-tools.
 *
 * Downloads historical Steam manifests for Icarus depot 1149461 and runs the
 * full export + transform pipeline for each one, producing versioned data in
 * talent-app/public/Data/{versionId}/.
 *
 * Each step is checkpointed in Downloads/backfill-log.json — only written on
 * success — so the script can be safely interrupted and resumed.
 *
 * Usage:
 *   node scripts/backfill.mjs --username=<steamUser> [--branch=default] [--downloader=DepotDownloader]
 *
 * Flags:
 *   --username=    (required) Steam username for DepotDownloader
 *   --branch=      Branch filter: "default" (stable, default), "experimental", or "all"
 *   --downloader=  Path to DepotDownloader executable (default: DepotDownloader)
 */

import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const CONFIG_PATH   = path.join(ROOT, 'backfill.config.json')
const DEPOTS_JSON   = path.join(ROOT, 'exporter', 'steam-depots.json')
const FILELIST      = path.join(ROOT, 'exporter', 'filelist.txt')
const DOWNLOADS_DIR = path.join(ROOT, 'Downloads')
const LOG_PATH      = path.join(DOWNLOADS_DIR, 'backfill-log.json')
const EXPORTER_DIR  = path.join(ROOT, 'exporter')
const TRANSFORM_DIR = path.join(ROOT, 'talent-transform')
const VERSIONS_JSON = path.join(ROOT, 'talent-app', 'public', 'Data', 'versions.json')
const APP_PUBLIC    = path.join(ROOT, 'talent-app', 'public')

// --- Arg parsing ---
function getArg(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix + '='))
  return arg ? arg.slice(prefix.length + 1) : null
}
function hasFlag(flag) {
  return process.argv.includes(flag)
}

// Load optional config file (credentials / local paths)
let config = {}
try {
  config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'))
} catch {
  // config file is optional
}

const username   = getArg('--username')   ?? config.username        ?? null
const password   = getArg('--password')   ?? config.password        ?? null
const branch     = getArg('--branch')     ?? 'default'
const downloader = getArg('--downloader') ?? config.downloaderPath  ?? 'DepotDownloader'

if (!username) {
  console.error('Error: Steam username is required.')
  console.error('  Set "username" in backfill.config.json, or pass --username=<steamUser>')
  console.error('Usage: node scripts/backfill.mjs [--username=<steamUser>] [--branch=default] [--downloader=PATH]')
  process.exit(1)
}

// --- Helpers ---

function separator() {
  console.log('─'.repeat(64))
}

function run(cmd, cmdArgs, { cwd, soft = false, shell = true } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, cmdArgs, { cwd, stdio: 'inherit', shell })
    proc.on('close', (code) => {
      if (code === 0 || soft) {
        if (code !== 0) {
          console.warn(`\n⚠️  Step exited with code ${code} (non-critical — continuing)`)
        }
        resolve(code)
      } else {
        reject(new Error(`Step failed with exit code ${code}`))
      }
    })
    proc.on('error', reject)
  })
}

async function readLog() {
  try {
    return JSON.parse(await fs.readFile(LOG_PATH, 'utf8'))
  } catch {
    return { entries: [] }
  }
}

async function writeLog(log) {
  await fs.mkdir(DOWNLOADS_DIR, { recursive: true })
  await fs.writeFile(LOG_PATH, JSON.stringify(log, null, 2) + '\n', 'utf8')
}

function findLogEntry(log, manifestId) {
  return log.entries.find((e) => e.manifestId === manifestId) ?? null
}

function upsertLogEntry(log, entry) {
  const idx = log.entries.findIndex((e) => e.manifestId === entry.manifestId)
  if (idx >= 0) {
    log.entries[idx] = { ...log.entries[idx], ...entry }
  } else {
    log.entries.push(entry)
  }
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function readLatestVersionId() {
  try {
    const index = JSON.parse(await fs.readFile(VERSIONS_JSON, 'utf8'))
    return index.latest ?? null
  } catch {
    return null
  }
}

// --- Main ---

async function main() {
  // Load manifest list
  const depots = JSON.parse(await fs.readFile(DEPOTS_JSON, 'utf8'))
  const allManifests = depots.apps['1149460'].depots['1149461'].knownManifests ?? []

  // Filter by branch
  const STABLE_BRANCH = 'default'
  const manifests = branch === 'all'
    ? allManifests
    : allManifests.filter((m) => m.branch === branch)

  if (manifests.length === 0) {
    console.error(`No manifests found for branch "${branch}". Available branches: ${[...new Set(allManifests.map((m) => m.branch))].join(', ')}`)
    process.exit(1)
  }

  // Sort newest-first
  const sorted = [...manifests].sort((a, b) => b.date.localeCompare(a.date))

  console.log(`\nBackfill: ${sorted.length} manifests (branch: ${branch}, newest-first)`)
  console.log(`Log: ${LOG_PATH}`)
  separator()

  const log = await readLog()

  let processed = 0
  let skipped = 0

  for (const manifest of sorted) {
    const { manifestId, date } = manifest
    const existing = findLogEntry(log, manifestId)

    // Already fully done
    if (existing?.transformedAt) {
      skipped++
      continue
    }

    separator()
    console.log(`Manifest: ${manifestId}`)
    console.log(`Date:     ${date}`)
    console.log(`Branch:   ${manifest.branch}`)
    separator()

    const downloadDir = path.join(DOWNLOADS_DIR, manifestId)
    const exportsDir  = path.join(downloadDir, 'Exports')
    const texturelist = path.join(exportsDir, 'texture-list.txt')

    // --- Step A: Download ---
    if (!existing?.downloadedAt) {
      console.log('\n[A] Downloading manifest...')
      const dlArgs = [
        '-app', '1149460',
        '-depot', '1149461',
        '-manifest', manifestId,
        '-username', username,
        '-filelist', FILELIST,
        '-dir', downloadDir,
        '-remember-password',
      ]
      if (password) dlArgs.push('-password', password)
      await run(downloader, dlArgs, { shell: false })
      upsertLogEntry(log, {
        manifestId,
        date,
        branch: manifest.branch,
        downloadDir: path.relative(ROOT, downloadDir),
        downloadedAt: new Date().toISOString(),
        exportsDir: path.relative(ROOT, exportsDir),
      })
      await writeLog(log)
      console.log('✓ Download recorded.')
    } else {
      console.log('\n[A] Download — skipped (already downloaded).')
    }

    // --- Step B: Export JSON ---
    console.log('\n[B] Exporting JSON...')
    await run('dotnet', ['run', '--', `--in="${downloadDir}"`, `--out="${exportsDir}"`], { cwd: EXPORTER_DIR })

    // --- Step C: Validate ---
    console.log('\n[C] Validating inputs...')
    await run('node', ['src/index.mjs', '--validate', `--game-export="${exportsDir}"`], { cwd: TRANSFORM_DIR })

    // --- Step D: Generate asset list ---
    console.log('\n[D] Generating asset list...')
    await run('node', ['scripts/assets.mjs', exportsDir, texturelist], { cwd: TRANSFORM_DIR })

    // --- Step E: Export textures (soft) ---
    console.log('\n[E] Exporting textures (soft)...')
    await run(
      'dotnet',
      ['run', '--', `--in="${downloadDir}"`, `--out="${exportsDir}"`, `--textures="${texturelist}"`, '--no-clean'],
      { cwd: EXPORTER_DIR, soft: true }
    )

    // --- Step F: Transform ---
    console.log('\n[F] Running transform...')
    await run(
      'node',
      ['src/index.mjs', `--game-export="${exportsDir}"`, `--app-public="${APP_PUBLIC}"`],
      { cwd: TRANSFORM_DIR }
    )

    const versionId = await readLatestVersionId()

    upsertLogEntry(log, {
      manifestId,
      versionId: versionId ?? '(unknown)',
      transformedAt: new Date().toISOString(),
    })
    await writeLog(log)

    processed++
    separator()
    console.log(`✅ Done: manifest ${manifestId} → version ${versionId ?? '(unknown)'}`)
    separator()

    // --- Step G: Prompt ---
    const remaining = sorted.filter((m) => {
      const e = findLogEntry(log, m.manifestId)
      return !e?.transformedAt
    }).length

    if (remaining === 0) {
      console.log('\nAll manifests processed.')
      break
    }

    const answer = await prompt(`\nContinue to next manifest? ${remaining} remaining. [Y/n]: `)
    if (answer.toLowerCase() === 'n') {
      console.log('\nStopped by user. Run again to resume.')
      break
    }
  }

  separator()
  console.log(`Backfill session complete. Processed: ${processed}, skipped (already done): ${skipped}.`)
  separator()
}

main().catch((err) => {
  console.error(`\n❌ Backfill aborted: ${err.message}`)
  process.exit(1)
})
