import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const args = process.argv.slice(2)
const options = parseArgs(args)
const exportsRoot = options.gameExport ?? path.resolve(__dirname, '../../Exports')
const requiredFiles = [
  [path.join(exportsRoot, 'Talents', 'D_TalentRanks.json'), path.join(exportsRoot, 'D_TalentRanks.json')],
  [path.join(exportsRoot, 'Talents', 'D_TalentModels.json'), path.join(exportsRoot, 'D_TalentModels.json')],
  [path.join(exportsRoot, 'Talents', 'D_TalentArchetypes.json'), path.join(exportsRoot, 'D_TalentArchetypes.json')],
  [path.join(exportsRoot, 'Talents', 'D_TalentTrees.json'), path.join(exportsRoot, 'D_TalentTrees.json')],
  [path.join(exportsRoot, 'Talents', 'D_Talents.json'), path.join(exportsRoot, 'D_Talents.json')],
  [
    path.join(exportsRoot, 'Talents', 'D_PlayerTalentModifiers.json'),
    path.join(exportsRoot, 'D_PlayerTalentModifiers.json')
  ],
  [
    path.join(exportsRoot, 'Icarus', 'Content', 'Localization', 'Game', 'Game.json'),
    path.join(exportsRoot, 'Content', 'Localization', 'Game', 'Game.json'),
    path.join(exportsRoot, 'Localization', 'Game', 'Game.json')
  ]
]

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--game-export') {
      opts.gameExport = argv[i + 1]
      i += 1
    }
  }
  return opts
}

async function exists(filePath) {
  try {
    const stat = await fs.lstat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

async function main() {
  const missing = []
  for (const candidatePaths of requiredFiles) {
    let found = false
    for (const filePath of candidatePaths) {
      if (await exists(filePath)) {
        found = true
        break
      }
    }

    if (!found) {
      missing.push(candidatePaths.join(' | '))
    }
  }

  if (missing.length > 0) {
    console.error('Transform preflight failed. Missing required Exports files:')
    missing.forEach((filePath) => console.error(`- ${filePath}`))
    process.exitCode = 1
    return
  }

  console.log('Transform preflight passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
