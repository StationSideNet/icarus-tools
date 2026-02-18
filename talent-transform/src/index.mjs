import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_GAME_EXPORT_DIR = path.resolve(__dirname, "../../Exports");
const DEFAULT_OUT_PATH = path.resolve(__dirname, "../../talent-app/public/Data/talents.json");
const DEFAULT_APP_PUBLIC_DIR = path.resolve(__dirname, "../../talent-app/public");

const INCLUDED_MODELS = new Set(["Player", "Creature", "Solo"]);
const SOLO_MODEL = "Solo";
const PLAYER_MODEL = "Player";
const CREATURE_MODEL = "Creature";
const CREATURE_BASE_ARCHETYPE = "Creature_Base";
const CREATURE_BASE_TREE = "Creature_Mount_Base";

const args = process.argv.slice(2);
const options = parseArgs(args);

const gameExportDir = options.gameExport ?? DEFAULT_GAME_EXPORT_DIR;
const outPath = options.out ?? DEFAULT_OUT_PATH;
const appPublicDir = options.appPublic ?? DEFAULT_APP_PUBLIC_DIR;

const rankFile = await resolveExistingFile(gameExportDir, ["Talents/D_TalentRanks.json", "D_TalentRanks.json"]);
const modelFile = await resolveExistingFile(gameExportDir, ["Talents/D_TalentModels.json", "D_TalentModels.json"]);
const archetypeFile = await resolveExistingFile(gameExportDir, ["Talents/D_TalentArchetypes.json", "D_TalentArchetypes.json"]);
const treeFile = await resolveExistingFile(gameExportDir, ["Talents/D_TalentTrees.json", "D_TalentTrees.json"]);
const talentFile = await resolveExistingFile(gameExportDir, ["Talents/D_Talents.json", "D_Talents.json"]);
const playerTalentModifierFile = await resolveExistingFile(gameExportDir, [
  "Talents/D_PlayerTalentModifiers.json",
  "D_PlayerTalentModifiers.json"
]);
const contentSourceDir = await resolveExistingDir(gameExportDir, ["Icarus/Content", "Content"]);
const localizationSourceDir = await resolveExistingDir(gameExportDir, [
  "Icarus/Content/Localization/Game",
  "Content/Localization/Game",
  "Localization/Game"
]);

const ranksData = await readJson(rankFile);
const modelsData = await readJson(modelFile);
const archetypesData = await readJson(archetypeFile);
const treesData = await readJson(treeFile);
const talentsData = await readJson(talentFile);
const playerTalentModifiersData = await readJson(playerTalentModifierFile);

const ranks = buildRanks(ranksData);
const models = buildModels(modelsData);
const archetypes = buildArchetypes(archetypesData, models);
const trees = buildTrees(treesData, archetypes);
const talents = buildTalents(talentsData, trees);
const playerTalentModifiers = buildPlayerTalentModifiers(playerTalentModifiersData);

const output = {
  schemaVersion: 4,
  generatedAt: new Date().toISOString(),
  source: {
    gameExportDir: path.relative(process.cwd(), gameExportDir)
  },
  playerTalentModifiers,
  ranks,
  models
};

attachArchetypesToModels(models, archetypes);
attachTreesToArchetypes(archetypes, trees);
attachTalentsToTrees(trees, talents);

await writeJson(outPath, output);

if (!options.skipCopyExports) {
  const exportsTargetRoot = path.join(appPublicDir, "Exports");
  const contentTargetDir = path.join(exportsTargetRoot, "Icarus", "Content");
  const localizationTargetDir = path.join(contentTargetDir, "Localization", "Game");

  await fs.rm(exportsTargetRoot, { recursive: true, force: true });

  const copiedLocales = await copyLocalizationFiles(localizationSourceDir, localizationTargetDir);
  const copyResult = await copyReferencedAssets({
    sourceContentDir: contentSourceDir,
    targetContentDir: contentTargetDir,
    unrealPaths: collectRuntimeAssetPaths(output)
  });

  if (copyResult.missingCritical.length > 0) {
    throw new Error(
      `Missing critical referenced assets (${copyResult.missingCritical.length}). First missing: ${copyResult.missingCritical[0]}`
    );
  }

  if (copyResult.missingOptional.length > 0) {
    console.warn(`Missing non-critical referenced assets: ${copyResult.missingOptional.length}`);
  }

  console.log(
    `Copied Exports subset to ${exportsTargetRoot} (locales: ${copiedLocales.length}, assets: ${copyResult.copiedCount})`
  );
}

console.log(`Wrote ${outPath}`);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--game-export") {
      opts.gameExport = argv[i + 1];
      i += 1;
    } else if (arg === "--out") {
      opts.out = argv[i + 1];
      i += 1;
    } else if (arg === "--app-public") {
      opts.appPublic = argv[i + 1];
      i += 1;
    } else if (arg === "--skip-copy-exports") {
      opts.skipCopyExports = true;
    } else if (arg === "--watch") {
      opts.watch = true;
    }
  }
  return opts;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function buildRanks(data) {
  const rows = data?.Rows ?? [];
  const rankMap = {};

  for (const row of rows) {
    const id = row.Name;
    rankMap[id] = {
      id,
      display: row.DisplayName ?? id,
      icon: normalizeNone(row.Icon),
      investment: row.Investment ?? 0,
      nextRank: row.NextRank?.RowName ?? null
    };
  }

  return rankMap;
}

function buildModels(data) {
  const rows = data?.Rows ?? [];
  const modelMap = {};

  for (const row of rows) {
    const id = row.Name;
    if (!INCLUDED_MODELS.has(id) || id === SOLO_MODEL) {
      continue;
    }

    modelMap[id] = {
      id,
      display: id,
      archetypes: {}
    };
  }

  if (!modelMap[PLAYER_MODEL]) {
    modelMap[PLAYER_MODEL] = {
      id: PLAYER_MODEL,
      display: PLAYER_MODEL,
      archetypes: {}
    };
  }

  if (!modelMap[CREATURE_MODEL]) {
    modelMap[CREATURE_MODEL] = {
      id: CREATURE_MODEL,
      display: CREATURE_MODEL,
      archetypes: {}
    };
  }

  return modelMap;
}

function buildArchetypes(data, models) {
  const rows = data?.Rows ?? [];
  const archetypeMap = {};

  for (const row of rows) {
    const sourceModel = row.Model?.RowName ?? "";
    if (!INCLUDED_MODELS.has(sourceModel)) {
      continue;
    }

    const id = row.Name;
    const modelId = sourceModel === SOLO_MODEL ? PLAYER_MODEL : sourceModel;

    archetypeMap[id] = {
      id,
      modelId,
      display: row.DisplayName ?? id,
      icon: normalizeNone(row.Icon),
      background: normalizeNone(row.BackgroundTexture),
      requiredLevel: row.RequiredLevel ?? 0,
      trees: {}
    };
  }

  if (!archetypeMap[CREATURE_BASE_ARCHETYPE]) {
    archetypeMap[CREATURE_BASE_ARCHETYPE] = {
      id: CREATURE_BASE_ARCHETYPE,
      modelId: CREATURE_MODEL,
      display: "Creature Base",
      icon: null,
      background: null,
      requiredLevel: 0,
      trees: {}
    };
  }

  for (const archetype of Object.values(archetypeMap)) {
    const model = models[archetype.modelId];
    if (!model) {
      continue;
    }
    model.archetypes[archetype.id] = archetype;
  }

  return archetypeMap;
}

function buildTrees(data, archetypes) {
  const rows = data?.Rows ?? [];
  const treeMap = {};

  for (const row of rows) {
    const id = row.Name;
    let archetypeId = row.Archetype?.RowName ?? "";

    if (id === CREATURE_BASE_TREE) {
      archetypeId = CREATURE_BASE_ARCHETYPE;
    }

    if (!archetypes[archetypeId]) {
      continue;
    }

    treeMap[id] = {
      id,
      archetypeId,
      display: row.DisplayName ?? id,
      icon: normalizeNone(row.Icon),
      background: normalizeNone(row.BackgroundTexture),
      firstRank: row.FirstRank?.RowName ?? null,
      requiredLevel: row.RequiredLevel ?? 0,
      talents: {}
    };
  }

  return treeMap;
}

function buildTalents(data, trees) {
  const rows = data?.Rows ?? [];
  const talentMap = {};

  for (const row of rows) {
    const id = row.Name;
    const treeId = row.TalentTree?.RowName ?? "";
    const tree = trees[treeId];

    if (!tree) {
      continue;
    }

    const displayText = row.DisplayName && row.DisplayName !== "" ? row.DisplayName : id;

    talentMap[id] = {
      id,
      treeId,
      type: row.TalentType ?? null,
      display: displayText,
      description: row.Description ?? "",
      icon: normalizeNone(row.Icon),
      extraData: row.ExtraData ?? null,
      position: normalizeVector(row.Position),
      size: normalizeVector(row.Size),
      requiredRank: row.RequiredRank?.RowName ?? null,
      requiredTalents: (row.RequiredTalents ?? []).map((talent) => talent.RowName).filter(Boolean),
      requiredFlags: row.RequiredFlags ?? [],
      forbiddenFlags: row.ForbiddenFlags ?? [],
      defaultUnlocked: row.bDefaultUnlocked ?? false,
      drawMethod: row.DrawMethodOverride ?? null,
      rewards: normalizeRewards(row.Rewards)
    };
  }

  return talentMap;
}

function buildPlayerTalentModifiers(data) {
  const rows = data?.Rows ?? [];

  return rows
    .map((row) => {
      const id = row?.Name;
      if (!id) {
        return null;
      }

      const points = Number(row?.TalentPointModifier);
      return {
        id,
        talentPointModifier: Number.isFinite(points) ? points : 0,
        requiredFlags: (row?.RequiredFlags ?? [])
          .map((flagRef) => flagRef?.RowName)
          .filter(Boolean),
        requiredFeatureLevel: row?.Metadata?.RequiredFeatureLevel?.RowName ?? null
      };
    })
    .filter(Boolean);
}

function attachArchetypesToModels(models, archetypes) {
  for (const archetype of Object.values(archetypes)) {
    const model = models[archetype.modelId];
    if (!model) {
      continue;
    }
    model.archetypes[archetype.id] = archetype;
  }
}

function attachTreesToArchetypes(archetypes, trees) {
  for (const tree of Object.values(trees)) {
    const archetype = archetypes[tree.archetypeId];
    if (!archetype) {
      continue;
    }
    archetype.trees[tree.id] = tree;
  }
}

function attachTalentsToTrees(trees, talents) {
  for (const talent of Object.values(talents)) {
    const tree = trees[talent.treeId];
    if (!tree) {
      continue;
    }
    tree.talents[talent.id] = talent;
  }
}

function normalizeRewards(rewards = []) {
  return rewards.map((reward) => {
    const grantedStats = reward?.GrantedStats ?? {};
    const effects = Object.entries(grantedStats).map(([rawKey, value]) => ({
      rawKey,
      value
    }));

    return {
      effects,
      flags: reward?.GrantedFlags ?? []
    };
  });
}

function normalizeVector(vector) {
  if (!vector) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.X ?? 0,
    y: vector.Y ?? 0
  };
}

function normalizeNone(value) {
  if (!value || value === "None") {
    return null;
  }
  return value;
}

function addUnrealPath(out, value) {
  if (typeof value === "string" && value.startsWith("/Game/")) {
    out.add(value);
  }
}

function collectRuntimeAssetPaths(dataJson) {
  const out = new Set();

  Object.values(dataJson?.ranks ?? {}).forEach((rank) => {
    addUnrealPath(out, rank?.icon);
  });

  Object.values(dataJson?.models ?? {}).forEach((model) => {
    Object.values(model?.archetypes ?? {}).forEach((archetype) => {
      addUnrealPath(out, archetype?.icon);
      addUnrealPath(out, archetype?.background);

      Object.values(archetype?.trees ?? {}).forEach((tree) => {
        addUnrealPath(out, tree?.icon);
        addUnrealPath(out, tree?.background);

        Object.values(tree?.talents ?? {}).forEach((talent) => {
          addUnrealPath(out, talent?.icon);
        });
      });
    });
  });

  return [...out];
}

function isCriticalAssetPath(unrealPath) {
  return unrealPath.includes("/Assets/2DArt/UI/Talents/");
}

function unrealToRelativePngPath(unrealPath) {
  if (!unrealPath.startsWith("/Game/")) {
    return null;
  }

  const pathWithoutPrefix = unrealPath.slice("/Game/".length);
  const packagePath = pathWithoutPrefix.split(".")[0];
  if (!packagePath) {
    return null;
  }

  return `${packagePath}.png`;
}

async function copyReferencedAssets({ sourceContentDir, targetContentDir, unrealPaths }) {
  const missingCritical = [];
  const missingOptional = [];
  const seenRelPaths = new Set();
  let copiedCount = 0;

  for (const unrealPath of unrealPaths) {
    const relPngPath = unrealToRelativePngPath(unrealPath);
    if (!relPngPath || seenRelPaths.has(relPngPath)) {
      continue;
    }
    seenRelPaths.add(relPngPath);

    const sourcePath = path.join(sourceContentDir, relPngPath);
    const targetPath = path.join(targetContentDir, relPngPath);

    if (!(await pathExists(sourcePath))) {
      if (isCriticalAssetPath(unrealPath)) {
        missingCritical.push(sourcePath);
      } else {
        missingOptional.push(sourcePath);
      }
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    copiedCount += 1;
  }

  return {
    copiedCount,
    missingCritical,
    missingOptional
  };
}

async function copyLocalizationFiles(sourceLocalizationDir, targetLocalizationDir) {
  const sourceManifestPath = path.join(sourceLocalizationDir, "Game.json");
  const manifestData = await readJson(sourceManifestPath);
  const localeCodes = Array.from(new Set([
    "en",
    manifestData?.NativeCulture,
    ...(Array.isArray(manifestData?.CompiledCultures) ? manifestData.CompiledCultures : [])
  ].filter(Boolean)));

  await fs.mkdir(targetLocalizationDir, { recursive: true });
  await fs.copyFile(sourceManifestPath, path.join(targetLocalizationDir, "Game.json"));

  for (const localeCode of localeCodes) {
    const sourceLocalePath = path.join(sourceLocalizationDir, localeCode, "Game.json");
    if (!(await pathExists(sourceLocalePath))) {
      throw new Error(`Missing localization file: ${sourceLocalePath}`);
    }

    const targetLocalePath = path.join(targetLocalizationDir, localeCode, "Game.json");
    await fs.mkdir(path.dirname(targetLocalePath), { recursive: true });
    await fs.copyFile(sourceLocalePath, targetLocalePath);
  }

  return localeCodes;
}

async function resolveExistingFile(baseDir, relativeCandidates) {
  for (const rel of relativeCandidates) {
    const fullPath = path.join(baseDir, rel);
    if (await pathExists(fullPath)) {
      return fullPath;
    }
  }

  throw new Error(
    `Could not find required input file under ${baseDir}. Tried: ${relativeCandidates.join(", ")}`
  );
}

async function resolveExistingDir(baseDir, relativeCandidates) {
  for (const rel of relativeCandidates) {
    const fullPath = path.join(baseDir, rel);
    if (!(await pathExists(fullPath))) {
      continue;
    }

    const stat = await fs.lstat(fullPath);
    if (stat.isDirectory()) {
      return fullPath;
    }
  }

  throw new Error(
    `Could not find required input directory under ${baseDir}. Tried: ${relativeCandidates.join(", ")}`
  );
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
