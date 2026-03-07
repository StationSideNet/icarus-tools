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
const EXTRA_RUNTIME_ASSET_PATHS = [
  "/Game/Assets/2DArt/UI/Icons/Icon_Solo.Icon_Solo",
  "/Game/Assets/2DArt/UI/Icons/T_ICON_Paws.T_ICON_Paws",
  "/Game/Assets/2DArt/UI/Icons/T_Icon_TechTree.T_Icon_TechTree",
  "/Game/Assets/2DArt/UI/Icons/Icon_RenCurrency.Icon_RenCurrency",
  "/Game/Assets/2DArt/UI/Icons/Icon_Speed.Icon_Speed",
  "/Game/Assets/2DArt/UI/Icons/Icon_AggressiveCreature.Icon_AggressiveCreature",
  "/Game/Assets/2DArt/UI/Icons/T_Icon_Homestead.T_Icon_Homestead"
];

const args = process.argv.slice(2);
const options = parseArgs(args);
main().catch(handleFatalError);

async function main() {
  const gameExportDir = options.gameExport ?? DEFAULT_GAME_EXPORT_DIR;
  const outPath = options.out ?? DEFAULT_OUT_PATH;
  const appPublicDir = options.appPublic ?? DEFAULT_APP_PUBLIC_DIR;

  await runInputPreflight(gameExportDir);

  if (options.validate) {
    console.log("✅ Validation passed. All required transform inputs are present.");
    return;
  }

  const rankFile = await resolveExistingFile(gameExportDir, ["Talents/D_TalentRanks.json"]);
  const modelFile = await resolveExistingFile(gameExportDir, ["Talents/D_TalentModels.json"]);
  const archetypeFile = await resolveExistingFile(gameExportDir, ["Talents/D_TalentArchetypes.json"]);
  const treeFile = await resolveExistingFile(gameExportDir, ["Talents/D_TalentTrees.json"]);
  const talentFile = await resolveExistingFile(gameExportDir, ["Talents/D_Talents.json"]);
  const mountsFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "AI", "D_Mounts.json")]);
  const playerTalentModifierFile = await resolveExistingFile(gameExportDir, ["Talents/D_PlayerTalentModifiers.json"]);
  const defaultGameIniFile = await resolveExistingFile(gameExportDir, ["Icarus/Config/DefaultGame.ini"]);
  const contentSourceDir = await resolveExistingDir(gameExportDir, ["Icarus/Content"]);
  const localizationSourceDir = await resolveExistingDir(gameExportDir, ["Icarus/Content/Localization/Game"]);

  const ranksData = await readJson(rankFile);
  const modelsData = await readJson(modelFile);
  const archetypesData = await readJson(archetypeFile);
  const treesData = await readJson(treeFile);
  const talentsData = await readJson(talentFile);
  const mountsData = mountsFile ? await readJson(mountsFile) : null;
  const playerTalentModifiersData = await readJson(playerTalentModifierFile);
  const projectVersion = await readProjectVersion(defaultGameIniFile);

  if (!mountsFile) {
    console.warn("D_Mounts.json not found. Creature mount icon overrides were skipped.");
  }

  const ranks = buildRanks(ranksData);
  const models = buildModels(modelsData);
  const mountIconOverrides = buildMountIconOverrides(mountsData);
  const archetypes = buildArchetypes(archetypesData, models, mountIconOverrides);
  const trees = buildTrees(treesData, archetypes, mountIconOverrides);
  const talents = buildTalents(talentsData, trees);
  const playerTalentModifiers = buildPlayerTalentModifiers(playerTalentModifiersData);
  const mountIconOverrideStats = summarizeMountIconOverrides(mountIconOverrides, archetypes, trees);

  const output = {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    projectVersion,
    source: {
      gameExportDir: path.relative(process.cwd(), gameExportDir),
      mountIconOverrides: mountIconOverrideStats
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
    const folderCopyStats = new Map();
    const sourceFileCountCache = new Map();

    await fs.rm(exportsTargetRoot, { recursive: true, force: true });

    const localizationResult = await copyLocalizationFiles(localizationSourceDir, localizationTargetDir);
    for (const copiedFile of localizationResult.copiedFiles) {
      await recordFolderCopyStat(folderCopyStats, exportsTargetRoot, copiedFile, sourceFileCountCache);
    }

    const copyResult = await copyReferencedAssets({
      sourceContentDir: contentSourceDir,
      targetContentDir: contentTargetDir,
      unrealPaths: [...collectRuntimeAssetPaths(output), ...EXTRA_RUNTIME_ASSET_PATHS]
    });

    for (const copiedFile of copyResult.copiedFiles) {
      await recordFolderCopyStat(folderCopyStats, exportsTargetRoot, copiedFile, sourceFileCountCache);
    }

    console.log(`\n=== COPY SUMMARY ===\n${renderFolderCopySummaryTree(exportsTargetRoot, folderCopyStats)}\n`);

    const totalMissingAssets = copyResult.missingCritical.length + copyResult.missingOptional.length;
    if (totalMissingAssets > 0) {
      const missingTree = renderMissingAssetsTree(copyResult);
      console.warn(
        `\n=== MISSING ASSETS ===\nDetected missing referenced assets (critical: ${copyResult.missingCritical.length}, non-critical: ${copyResult.missingOptional.length})\n${missingTree}\n`
      );
    }

    if (copyResult.missingCritical.length > 0) {
      throw new Error(`Missing critical referenced assets: ${copyResult.missingCritical.length}`);
    }

    console.log(
      `Copied Exports subset to ${exportsTargetRoot} (locales: ${localizationResult.localeCodes.length}, assets: ${copyResult.copiedCount})`
    );
  }

  console.log(`Wrote ${outPath}`);
}

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
    } else if (arg === "--validate") {
      opts.validate = true;
    } else if (arg === "--skip-copy-exports") {
      opts.skipCopyExports = true;
    }
  }
  return opts;
}

class PreflightError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PreflightError";
    this.details = details;
  }
}

async function runInputPreflight(gameExportDir) {
  const requiredFiles = [
    "Talents/D_TalentRanks.json",
    "Talents/D_TalentModels.json",
    "Talents/D_TalentArchetypes.json",
    "Talents/D_TalentTrees.json",
    "Talents/D_Talents.json",
    "Talents/D_PlayerTalentModifiers.json",
    "Icarus/Config/DefaultGame.ini"
  ];
  const requiredDirs = [
    "Icarus/Content",
    "Icarus/Content/Localization/Game"
  ];

  const missingFiles = [];
  const missingDirs = [];

  for (const relPath of requiredFiles) {
    const fullPath = path.join(gameExportDir, relPath);
    if (!(await pathExists(fullPath))) {
      missingFiles.push(relPath);
    }
  }

  for (const relPath of requiredDirs) {
    const fullPath = path.join(gameExportDir, relPath);
    if (!(await pathExists(fullPath))) {
      missingDirs.push(relPath);
      continue;
    }

    const stat = await fs.lstat(fullPath);
    if (!stat.isDirectory()) {
      missingDirs.push(relPath);
    }
  }

  if (missingFiles.length === 0 && missingDirs.length === 0) {
    return;
  }

  throw new PreflightError("Preflight input check failed.", {
    gameExportDir,
    missingFiles,
    missingDirs,
    tree: renderPreflightMissingTree(missingFiles, missingDirs)
  });
}

function renderPreflightMissingTree(missingFiles, missingDirs) {
  const rootNode = { dirs: new Map(), files: new Set() };

  insertPreflightFiles(rootNode, missingFiles);
  insertPreflightDirs(rootNode, missingDirs);

  const lines = ["MissingRequiredInputs/"];
  appendTreeLines(rootNode, "", lines);
  return lines.join("\n");
}

function insertPreflightFiles(rootNode, missingFiles) {
  for (const relPath of missingFiles) {
    const parts = relPath.split("/").filter(Boolean);
    const fileName = parts.pop();
    let node = rootNode;

    for (const part of parts) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { dirs: new Map(), files: new Set() });
      }
      node = node.dirs.get(part);
    }

    if (fileName) {
      node.files.add(fileName);
    }
  }
}

function insertPreflightDirs(rootNode, missingDirs) {
  for (const relPath of missingDirs) {
    const parts = relPath.split("/").filter(Boolean);
    let node = rootNode;

    for (const part of parts) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { dirs: new Map(), files: new Set() });
      }
      node = node.dirs.get(part);
    }
  }
}

function handleFatalError(error) {
  console.error("\n========================================");
  console.error("❌ TRANSFORM FAILED");
  console.error("========================================");

  if (error instanceof PreflightError) {
    console.error(`Input root: ${error.details.gameExportDir}`);
    console.error("\nPreflight found missing required inputs:\n");
    console.error(error.details.tree);
    console.error("\nTip: run `npm run validate` after fixing your Exports layout.");
  } else {
    console.error(error?.message ?? String(error));
  }

  process.exitCode = 1;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function readProjectVersion(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("[")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (key.toLowerCase() !== "projectversion") {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).trim();
    }

    if (value) {
      return value;
    }
  }

  throw new Error(`Could not find non-empty ProjectVersion in ${filePath}`);
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

function buildArchetypes(data, models, mountIconOverrides = {}) {
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
      icon: mountIconOverrides[id] ?? normalizeNone(row.Icon),
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

function buildTrees(data, archetypes, mountIconOverrides = {}) {
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
      icon: mountIconOverrides[id] ?? normalizeNone(row.Icon),
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

function buildMountIconOverrides(data) {
  const rows = data?.Rows ?? [];
  const iconOverrides = {};

  for (const row of rows) {
    const archetypeId = row?.MountTalentArchetype?.RowName ?? null;
    const icon = normalizeNone(row?.Icon);

    if (!archetypeId || !icon || iconOverrides[archetypeId]) {
      continue;
    }

    iconOverrides[archetypeId] = icon;
  }

  return iconOverrides;
}

function summarizeMountIconOverrides(iconOverrides, archetypes, trees) {
  const overrideIds = Object.keys(iconOverrides);
  let appliedArchetypeIcons = 0;
  let appliedTreeIcons = 0;

  for (const id of overrideIds) {
    if (archetypes[id]?.icon === iconOverrides[id]) {
      appliedArchetypeIcons += 1;
    }

    if (trees[id]?.icon === iconOverrides[id]) {
      appliedTreeIcons += 1;
    }
  }

  return {
    discovered: overrideIds.length,
    appliedArchetypeIcons,
    appliedTreeIcons
  };
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
  const copiedFiles = [];
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
        missingCritical.push(relPngPath);
      } else {
        missingOptional.push(relPngPath);
      }
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    copiedFiles.push({ sourcePath, targetPath });
    copiedCount += 1;
  }

  return {
    copiedCount,
    missingCritical,
    missingOptional,
    copiedFiles
  };
}

function renderMissingAssetsTree({ missingCritical = [], missingOptional = [] }) {
  const rootNode = { dirs: new Map(), files: new Set() };

  insertPathsIntoTree(rootNode, missingCritical, "critical");
  insertPathsIntoTree(rootNode, missingOptional, "non-critical");

  const lines = ["MissingAssets/"];
  appendTreeLines(rootNode, "", lines);
  return lines.join("\n");
}

function insertPathsIntoTree(rootNode, relativePaths, categoryName) {
  if (!relativePaths.length) {
    return;
  }

  for (const relPath of relativePaths) {
    const cleanPath = relPath.split(path.sep).join("/");
    const parts = [categoryName, ...cleanPath.split("/").filter(Boolean)];
    const fileName = parts.pop();

    let node = rootNode;
    for (const part of parts) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { dirs: new Map(), files: new Set() });
      }
      node = node.dirs.get(part);
    }

    if (fileName) {
      node.files.add(fileName);
    }
  }
}

function appendTreeLines(node, prefix, lines) {
  const dirEntries = [...node.dirs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, childNode]) => ({ name, childNode, isDirectory: true }));
  const fileEntries = [...node.files]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, childNode: null, isDirectory: false }));
  const entries = [...dirEntries, ...fileEntries];

  entries.forEach(({ name, childNode, isDirectory }, index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "└── " : "├── ";

    if (isDirectory) {
      lines.push(`${prefix}${branch}${name}/`);
      const nextPrefix = `${prefix}${isLast ? "    " : "│   "}`;
      appendTreeLines(childNode, nextPrefix, lines);
      return;
    }

    lines.push(`${prefix}${branch}${name}`);
  });
}

async function copyLocalizationFiles(sourceLocalizationDir, targetLocalizationDir) {
  const sourceManifestPath = path.join(sourceLocalizationDir, "Game.json");
  const manifestData = await readJson(sourceManifestPath);
  const copiedFiles = [];
  const localeCodes = Array.from(new Set([
    "en",
    manifestData?.NativeCulture,
    ...(Array.isArray(manifestData?.CompiledCultures) ? manifestData.CompiledCultures : [])
  ].filter(Boolean)));

  await fs.mkdir(targetLocalizationDir, { recursive: true });
  const targetManifestPath = path.join(targetLocalizationDir, "Game.json");
  await fs.copyFile(sourceManifestPath, targetManifestPath);
  copiedFiles.push({ sourcePath: sourceManifestPath, targetPath: targetManifestPath });

  for (const localeCode of localeCodes) {
    const sourceLocalePath = path.join(sourceLocalizationDir, localeCode, "Game.json");
    if (!(await pathExists(sourceLocalePath))) {
      throw new Error(`Missing localization file: ${sourceLocalePath}`);
    }

    const targetLocalePath = path.join(targetLocalizationDir, localeCode, "Game.json");
    await fs.mkdir(path.dirname(targetLocalePath), { recursive: true });
    await fs.copyFile(sourceLocalePath, targetLocalePath);
    copiedFiles.push({ sourcePath: sourceLocalePath, targetPath: targetLocalePath });
  }

  return {
    localeCodes,
    copiedFiles
  };
}

async function recordFolderCopyStat(statsMap, rootDir, copiedFile, sourceFileCountCache) {
  const relFolderPath = path.relative(rootDir, path.dirname(copiedFile.targetPath)).split(path.sep).join("/") || ".";
  const sourceFolderPath = path.dirname(copiedFile.sourcePath);
  const sourceFolderFileCount = await countFilesNonRecursive(sourceFolderPath, sourceFileCountCache);

  if (!statsMap.has(relFolderPath)) {
    statsMap.set(relFolderPath, { copied: 0, present: sourceFolderFileCount });
  }

  const stats = statsMap.get(relFolderPath);
  stats.copied += 1;
}

async function countFilesNonRecursive(dirPath, cache) {
  if (cache.has(dirPath)) {
    return cache.get(dirPath);
  }

  let count = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    count = entries.filter((entry) => entry.isFile()).length;
  } catch {
    count = 0;
  }

  cache.set(dirPath, count);
  return count;
}

function renderFolderCopySummaryTree(exportsTargetRoot, folderCopyStats) {
  const rootNode = {
    children: new Map(),
    stats: { copied: 0, present: 0 }
  };

  for (const [folderPath, stats] of folderCopyStats.entries()) {
    const parts = folderPath === "." ? [] : folderPath.split("/").filter(Boolean);
    let node = rootNode;

    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, {
          children: new Map(),
          stats: { copied: 0, present: 0 }
        });
      }
      node = node.children.get(part);
    }

    node.stats.copied += stats.copied;
    node.stats.present = stats.present;
  }

  const rootLabel = `${path.basename(exportsTargetRoot) || "Exports"}/`;
  const lines = [rootLabel];
  appendFolderSummaryLines(rootNode, "", lines);

  return lines.join("\n");
}

function appendFolderSummaryLines(node, prefix, lines) {
  const entries = [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b));
  const visibleEntries = entries.filter(([, childNode]) => isVisibleFolderNode(childNode));

  visibleEntries.forEach(([label, childNode], index) => {
    const isLast = index === visibleEntries.length - 1;
    const branch = isLast ? "└── " : "├── ";
    const stats = childNode.stats;
    const hasOwnStats = stats.copied > 0 || stats.present > 0;
    lines.push(
      hasOwnStats
        ? `${prefix}${branch}${label}/ (${stats.copied} of ${stats.present})`
        : `${prefix}${branch}${label}/`
    );
    const nextPrefix = `${prefix}${isLast ? "    " : "│   "}`;
    appendFolderSummaryLines(childNode, nextPrefix, lines);
  });
}

function isVisibleFolderNode(node) {
  const hasOwnStats = node.stats.copied > 0 || node.stats.present > 0;
  if (hasOwnStats) {
    return true;
  }

  for (const childNode of node.children.values()) {
    if (isVisibleFolderNode(childNode)) {
      return true;
    }
  }

  return false;
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

async function resolveOptionalAbsoluteFile(candidates) {
  for (const fullPath of candidates) {
    if (await pathExists(fullPath)) {
      return fullPath;
    }
  }

  return null;
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
