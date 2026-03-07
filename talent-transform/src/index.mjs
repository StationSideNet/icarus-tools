import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_GAME_EXPORT_DIR = path.resolve(__dirname, "../../Exports");
const DEFAULT_TALENTS_OUT_PATH = path.resolve(__dirname, "../../talent-app/public/Data/talents.json");
const DEFAULT_BLUEPRINTS_OUT_PATH = path.resolve(__dirname, "../../talent-app/public/Data/blueprints.json");
const DEFAULT_APP_PUBLIC_DIR = path.resolve(__dirname, "../../talent-app/public");

const SOLO_MODEL = "Solo";
const PLAYER_MODEL = "Player";
const CREATURE_MODEL = "Creature";
const BLUEPRINT_MODEL = "Blueprint";
const CREATURE_BASE_ARCHETYPE = "Creature_Base";
const CREATURE_BASE_TREE = "Creature_Mount_Base";
const TALENT_MODEL_IDS = new Set([PLAYER_MODEL, CREATURE_MODEL, SOLO_MODEL]);
const BLUEPRINT_MODEL_IDS = new Set([BLUEPRINT_MODEL]);
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
  const talentsOutPath = options.out ?? DEFAULT_TALENTS_OUT_PATH;
  const blueprintsOutPath = options.outBlueprints ?? DEFAULT_BLUEPRINTS_OUT_PATH;
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
  const itemableFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Traits", "D_Itemable.json")]);
  const itemsStaticFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Items", "D_ItemsStatic.json")]);
  const durableFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Traits", "D_Durable.json")]);
  const buildableFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Traits", "D_Buildable.json")]);
  const deployableFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Traits", "D_Deployable.json")]);
  const consumableFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Traits", "D_Consumable.json")]);
  const equippableFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Traits", "D_Equippable.json")]);
  const usableFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Traits", "D_Usable.json")]);
  const armourFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Traits", "D_Armour.json")]);
  const recipesFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Crafting", "D_ProcessorRecipes.json")]);
  const recipeSetsFile = await resolveOptionalAbsoluteFile([path.join(gameExportDir, "Crafting", "D_RecipeSets.json")]);
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
  const itemableData = itemableFile ? await readJson(itemableFile) : null;
  const itemsStaticData = itemsStaticFile ? await readJson(itemsStaticFile) : null;
  const durableData = durableFile ? await readJson(durableFile) : null;
  const buildableData = buildableFile ? await readJson(buildableFile) : null;
  const deployableData = deployableFile ? await readJson(deployableFile) : null;
  const consumableData = consumableFile ? await readJson(consumableFile) : null;
  const equippableData = equippableFile ? await readJson(equippableFile) : null;
  const usableData = usableFile ? await readJson(usableFile) : null;
  const armourData = armourFile ? await readJson(armourFile) : null;
  const recipesData = recipesFile ? await readJson(recipesFile) : null;
  const recipeSetsData = recipeSetsFile ? await readJson(recipeSetsFile) : null;
  const mountsData = mountsFile ? await readJson(mountsFile) : null;
  const playerTalentModifiersData = await readJson(playerTalentModifierFile);
  const projectVersion = await readProjectVersion(defaultGameIniFile);

  if (!mountsFile) {
    console.warn("D_Mounts.json not found. Creature mount icon overrides were skipped.");
  }

  if (!itemableFile || !itemsStaticFile) {
    console.warn("Traits/D_Itemable.json or Items/D_ItemsStatic.json not found. Blueprint item enrichment will be limited.");
  }

  const ranks = buildRanks(ranksData);
  const models = buildModels(modelsData, TALENT_MODEL_IDS);
  const mountIconOverrides = buildMountIconOverrides(mountsData);
  const archetypes = buildArchetypes(archetypesData, models, mountIconOverrides);
  const trees = buildTrees(treesData, archetypes, mountIconOverrides);
  const talents = buildTalents(talentsData, trees);
  const playerTalentModifiers = buildPlayerTalentModifiers(playerTalentModifiersData);
  const mountIconOverrideStats = summarizeMountIconOverrides(mountIconOverrides, archetypes, trees);

  const blueprintModels = buildModels(modelsData, BLUEPRINT_MODEL_IDS);
  const blueprintArchetypes = buildArchetypes(archetypesData, blueprintModels, {});
  const blueprintTrees = buildTrees(treesData, blueprintArchetypes, {});
  const blueprintEnrichmentResolver = createBlueprintEnrichmentResolver({
    itemableData,
    itemsStaticData,
    durableData,
    buildableData,
    deployableData,
    consumableData,
    equippableData,
    usableData,
    armourData,
    recipesData,
    recipeSetsData
  });
  const blueprints = buildTalents(talentsData, blueprintTrees, blueprintEnrichmentResolver);

  const talentOutput = {
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

  const blueprintOutput = {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    projectVersion,
    source: {
      gameExportDir: path.relative(process.cwd(), gameExportDir)
    },
    ranks,
    models: blueprintModels
  };

  attachArchetypesToModels(blueprintModels, blueprintArchetypes);
  attachTreesToArchetypes(blueprintArchetypes, blueprintTrees);
  attachTalentsToTrees(blueprintTrees, blueprints);

  const talentIconCoverage = summarizeIconCoverage(talentOutput);
  const blueprintIconCoverage = summarizeIconCoverage(blueprintOutput);
  const missingIconSlots = [
    ...collectMissingIconSlots(talentOutput, "Talents"),
    ...collectMissingIconSlots(blueprintOutput, "Blueprints/TechTree")
  ];

  logIconCoverageSummary("Talents", talentIconCoverage);
  logIconCoverageSummary("Blueprints/TechTree", blueprintIconCoverage);

  if (blueprintIconCoverage.talentsMissingIcon > 0) {
    console.warn(
      `Blueprint icon coverage warning: ${blueprintIconCoverage.talentsMissingIcon} talents have no resolved icon.`
    );
  }

  if (missingIconSlots.length > 0) {
    console.warn(
      `\n=== MISSING ICON SLOTS ===\nDetected icon fields without values across datasets: ${missingIconSlots.length}\n${renderMissingIconSlotsTree(missingIconSlots)}\n`
    );
  }

  await writeJson(talentsOutPath, talentOutput);
  await writeJson(blueprintsOutPath, blueprintOutput);

  const assetRefs = [
    ...collectRuntimeAssetReferences(talentOutput, "Talents"),
    ...collectRuntimeAssetReferences(blueprintOutput, "Blueprints/TechTree"),
    ...EXTRA_RUNTIME_ASSET_PATHS.map((unrealPath) => ({
      unrealPath,
      sourceLabel: "AppRuntime",
      isIcon: true
    }))
  ];

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
      assetRefs
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

    if (copyResult.missingIcons.length > 0) {
      const missingIconsTree = renderMissingIconsTree(copyResult.missingIcons);
      console.warn(
        `\n=== MISSING ICONS ===\nDetected missing icon assets across all datasets: ${copyResult.missingIcons.length}\n${missingIconsTree}\n`
      );
    }

    if (copyResult.missingCritical.length > 0) {
      throw new Error(`Missing critical referenced assets: ${copyResult.missingCritical.length}`);
    }

    console.log(
      `Copied Exports subset to ${exportsTargetRoot} (locales: ${localizationResult.localeCodes.length}, assets: ${copyResult.copiedCount})`
    );
  }

  console.log(`Wrote ${talentsOutPath}`);
  console.log(`Wrote ${blueprintsOutPath}`);
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
    } else if (arg === "--out-blueprints") {
      opts.outBlueprints = argv[i + 1];
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

function buildModels(data, includeModelIds = TALENT_MODEL_IDS) {
  const rows = data?.Rows ?? [];
  const modelMap = {};

  for (const row of rows) {
    const id = row.Name;
    if (!includeModelIds.has(id) || id === SOLO_MODEL) {
      continue;
    }

    modelMap[id] = {
      id,
      display: id,
      archetypes: {}
    };
  }

  if (includeModelIds.has(PLAYER_MODEL) && !modelMap[PLAYER_MODEL]) {
    modelMap[PLAYER_MODEL] = {
      id: PLAYER_MODEL,
      display: PLAYER_MODEL,
      archetypes: {}
    };
  }

  if (includeModelIds.has(CREATURE_MODEL) && !modelMap[CREATURE_MODEL]) {
    modelMap[CREATURE_MODEL] = {
      id: CREATURE_MODEL,
      display: CREATURE_MODEL,
      archetypes: {}
    };
  }

  if (includeModelIds.has(BLUEPRINT_MODEL) && !modelMap[BLUEPRINT_MODEL]) {
    modelMap[BLUEPRINT_MODEL] = {
      id: BLUEPRINT_MODEL,
      display: BLUEPRINT_MODEL,
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
    const id = row.Name;
    const modelId = sourceModel === SOLO_MODEL && models[PLAYER_MODEL] ? PLAYER_MODEL : sourceModel;

    if (!models[modelId]) {
      continue;
    }

    archetypeMap[id] = {
      id,
      modelId,
      display: row.DisplayName ?? id,
      icon: mountIconOverrides[id] ?? normalizeNone(row.Icon),
      background: normalizeNone(row.BackgroundTexture),
      requiredLevel: row.RequiredLevel ?? 0,
      requiredFeatureLevel: row.Metadata?.RequiredFeatureLevel?.RowName ?? null,
      trees: {}
    };
  }

  if (models[CREATURE_MODEL] && !archetypeMap[CREATURE_BASE_ARCHETYPE]) {
    archetypeMap[CREATURE_BASE_ARCHETYPE] = {
      id: CREATURE_BASE_ARCHETYPE,
      modelId: CREATURE_MODEL,
      display: "Creature Base",
      icon: null,
      background: null,
      requiredLevel: 0,
      requiredFeatureLevel: null,
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
      requiredFeatureLevel: row.Metadata?.RequiredFeatureLevel?.RowName ?? null,
      talents: {}
    };
  }

  return treeMap;
}

function buildTalents(data, trees, enrichmentResolver = null) {
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
    const itemDetails = enrichmentResolver ? enrichmentResolver(row) : null;
    const resolvedIcon = normalizeNone(row.Icon) ?? normalizeNone(itemDetails?.icon);

    talentMap[id] = {
      id,
      treeId,
      type: row.TalentType ?? null,
      display: displayText,
      description: row.Description ?? "",
      icon: resolvedIcon,
      extraData: row.ExtraData ?? null,
      position: normalizeVector(row.Position),
      size: normalizeVector(row.Size),
      requiredRank: row.RequiredRank?.RowName ?? null,
      requiredLevel: row.RequiredLevel ?? 0,
      requiredFeatureLevel: row.Metadata?.RequiredFeatureLevel?.RowName ?? null,
      requiredTalents: (row.RequiredTalents ?? []).map((talent) => talent.RowName).filter(Boolean),
      requiredFlags: row.RequiredFlags ?? [],
      forbiddenFlags: row.ForbiddenFlags ?? [],
      defaultUnlocked: row.bDefaultUnlocked ?? false,
      drawMethod: row.DrawMethodOverride ?? null,
      rewards: normalizeRewards(row.Rewards),
      itemDetails
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

function createBlueprintEnrichmentResolver({
  itemableData,
  itemsStaticData,
  durableData,
  buildableData,
  deployableData,
  consumableData,
  equippableData,
  usableData,
  armourData,
  recipesData,
  recipeSetsData
}) {
  const itemableById = indexRowsByName(itemableData);
  const staticById = indexRowsByName(itemsStaticData);
  const staticByItemableId = indexItemsStaticByItemable(itemsStaticData);
  const durableById = indexRowsByName(durableData);
  const buildableById = indexRowsByName(buildableData);
  const deployableById = indexRowsByName(deployableData);
  const consumableById = indexRowsByName(consumableData);
  const equippableById = indexRowsByName(equippableData);
  const usableById = indexRowsByName(usableData);
  const armourById = indexRowsByName(armourData);
  const recipeSetById = indexRowsByName(recipeSetsData);
  const recipesByRequirement = indexRecipesByRequirement(recipesData);

  function resolveRecipes(talentId) {
    const recipeRows = recipesByRequirement[talentId] ?? [];
    return recipeRows.map((recipe) => {
      const craftedAt = (recipe.RecipeSets ?? [])
        .map((ref) => {
          const setId = ref?.RowName;
          if (!setId || setId === "None") return null;
          const setRow = recipeSetById[setId];
          return {
            id: setId,
            display: setRow?.RecipeSetName ?? setId
          };
        })
        .filter(Boolean);

      const inputs = (recipe.Inputs ?? []).map((input) => {
        const staticItemId = input?.Element?.RowName;
        if (!staticItemId || staticItemId === "None") return null;
        const staticRow = staticById[staticItemId];
        const itemableId = normalizeRefRowName(staticRow?.Itemable);
        const itemableRow = itemableId ? itemableById[itemableId] : null;
        return {
          staticItemId,
          display: itemableRow?.DisplayName ?? staticItemId,
          count: Number.isFinite(Number(input?.Count)) ? Number(input.Count) : 1
        };
      }).filter(Boolean);

      const outputStaticId = recipe.Outputs?.[0]?.Element?.RowName;
      const outputStaticRow = outputStaticId ? staticById[outputStaticId] : null;
      const outputItemableId = normalizeRefRowName(outputStaticRow?.Itemable);
      const outputItemableRow = outputItemableId ? itemableById[outputItemableId] : null;

      // Resolve armor stats from output item
      const armourRef = normalizeRefRowName(outputStaticRow?.Armour);
      const armourRow = armourRef ? armourById[armourRef] : null;
      const armourStats = armourRow ? normalizeStatMap(armourRow.ArmourStats ?? {}) : null;
      const armourType = armourRow?.ArmourType ?? null;

      return {
        id: recipe.Name,
        display: outputItemableRow?.DisplayName ?? recipe.Name,
        craftedAt,
        inputs,
        armourStats: Object.keys(armourStats ?? {}).length > 0 ? armourStats : null,
        armourType
      };
    });
  }

  return (talentRow) => {
    const talentId = talentRow?.Name;
    const itemableId = talentRow?.ExtraData?.DataTableName === "D_Itemable"
      ? talentRow?.ExtraData?.RowName ?? null
      : null;

    // Resolve recipes for this talent (works for both single and multi-item talents)
    const recipes = resolveRecipes(talentId);

    if (!itemableId) {
      // Multi-blueprint talent (no single item) — return recipes only
      if (recipes.length === 0) return null;
      return { recipes };
    }

    const itemableRow = itemableById[itemableId] ?? null;
    const staticRow = staticByItemableId[itemableId] ?? null;
    const staticId = staticRow?.Name ?? null;

    const durableRow = getTraitRowByRef(staticRow, "Durable", durableById);
    const buildableRow = getTraitRowByRef(staticRow, "Buildable", buildableById);
    const deployableRow = getTraitRowByRef(staticRow, "Deployable", deployableById);
    const consumableRow = getTraitRowByRef(staticRow, "Consumable", consumableById);
    const equippableRow = getTraitRowByRef(staticRow, "Equippable", equippableById);
    const usableRow = getTraitRowByRef(staticRow, "Usable", usableById);

    const categories = [];
    if (buildableRow) categories.push("Buildable");
    if (deployableRow) categories.push("Deployable");
    if (consumableRow) categories.push("Consumable");
    if (equippableRow) categories.push("Equippable");
    if (durableRow) categories.push("Durable");
    if (usableRow) categories.push("Usable");

    return {
      itemableId,
      staticId,
      display: itemableRow?.DisplayName ?? null,
      description: itemableRow?.Description ?? null,
      flavorText: itemableRow?.FlavorText ?? null,
      icon: normalizeNone(itemableRow?.Icon),
      glowIcon: normalizeNone(itemableRow?.Override_Glow_Icon),
      weight: Number.isFinite(Number(itemableRow?.Weight)) ? Number(itemableRow?.Weight) : null,
      maxStack: Number.isFinite(Number(itemableRow?.MaxStack)) ? Number(itemableRow?.MaxStack) : null,
      categories,
      tags: extractItemTags(staticRow),
      durable: extractDurableDetails(durableRow, staticById, staticByItemableId, itemableById),
      buildable: extractBuildableDetails(buildableRow),
      deployable: extractDeployableDetails(deployableRow),
      consumable: extractConsumableDetails(consumableRow),
      equippable: extractEquippableDetails(equippableRow),
      usable: extractUsableDetails(usableRow),
      recipes
    };
  };
}

function indexRowsByName(tableData) {
  const rows = tableData?.Rows ?? [];
  const byName = {};

  rows.forEach((row) => {
    const rowName = row?.Name;
    if (!rowName) {
      return;
    }

    byName[rowName] = row;
  });

  return byName;
}

function indexItemsStaticByItemable(itemsStaticData) {
  const rows = itemsStaticData?.Rows ?? [];
  const byItemableId = {};

  rows.forEach((row) => {
    const itemableId = normalizeRefRowName(row?.Itemable);
    if (!itemableId || byItemableId[itemableId]) {
      return;
    }

    byItemableId[itemableId] = row;
  });

  return byItemableId;
}

function indexRecipesByRequirement(recipesData) {
  const rows = recipesData?.Rows ?? [];
  const byRequirement = {};

  rows.forEach((row) => {
    if (row?.bForceDisableRecipe) return;
    const reqId = row?.Requirement?.RowName;
    if (!reqId || reqId === "None") return;
    if (!byRequirement[reqId]) byRequirement[reqId] = [];
    byRequirement[reqId].push(row);
  });

  return byRequirement;
}

function normalizeRefRowName(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rowName = value.RowName;
  if (!rowName || rowName === "None") {
    return null;
  }

  return rowName;
}

function getTraitRowByRef(itemStaticRow, traitKey, traitRowsById) {
  const traitId = normalizeRefRowName(itemStaticRow?.[traitKey]);
  if (!traitId) {
    return null;
  }

  return traitRowsById?.[traitId] ?? null;
}

function extractItemTags(itemStaticRow) {
  const manual = (itemStaticRow?.Manual_Tags?.GameplayTags ?? []).map((tag) => tag?.TagName).filter(Boolean);
  const generated = (itemStaticRow?.Generated_Tags?.GameplayTags ?? []).map((tag) => tag?.TagName).filter(Boolean);
  return Array.from(new Set([...manual, ...generated]));
}

function extractDurableDetails(durableRow, staticById, staticByItemableId, itemableById) {
  if (!durableRow) {
    return null;
  }

  const maxDurability = Number.isFinite(Number(durableRow.Max_Durability)) ? Number(durableRow.Max_Durability) : null;
  const destroyedAtZero = Boolean(durableRow.Destroyed_At_Zero);
  const repairItems = (durableRow.ItemsForRepair ?? []).map((repairItem) => {
    const staticItemId = normalizeRefRowName(repairItem?.Item);
    const staticRow = staticItemId ? staticById?.[staticItemId] : null;
    const itemableId = normalizeRefRowName(staticRow?.Itemable);
    const itemableRow = itemableId ? itemableById?.[itemableId] : null;

    return {
      staticItemId,
      itemableId,
      display: itemableRow?.DisplayName ?? itemableId ?? staticItemId,
      amount: Number.isFinite(Number(repairItem?.Amount)) ? Number(repairItem.Amount) : null
    };
  }).filter((item) => item.staticItemId || item.itemableId);

  return {
    maxDurability,
    destroyedAtZero,
    repairItems
  };
}

function extractBuildableDetails(buildableRow) {
  if (!buildableRow) {
    return null;
  }

  const variations = buildableRow?.Variations ?? [];
  return {
    typeId: normalizeRefRowName(buildableRow?.Type),
    pieceType: buildableRow?.PieceType ?? null,
    variationCount: variations.length,
    talentGatedVariationCount: variations.filter((variation) => normalizeRefRowName(variation?.Requirement)).length
  };
}

function extractDeployableDetails(deployableRow) {
  if (!deployableRow) {
    return null;
  }

  return {
    variantCount: (deployableRow?.Variants ?? []).length,
    affectedByWeather: Boolean(deployableRow?.EffectedByWeather),
    mustBeOutside: Boolean(deployableRow?.bMustBeOutside),
    forceShowShelterIcon: Boolean(deployableRow?.bForceShowShelterIcon)
  };
}

function extractConsumableDetails(consumableRow) {
  if (!consumableRow) {
    return null;
  }

  return {
    stats: normalizeStatMap(consumableRow?.Stats),
    modifierId: normalizeRefRowName(consumableRow?.Modifier?.Modifier),
    modifierLifetime: Number.isFinite(Number(consumableRow?.Modifier?.ModifierLifetime))
      ? Number(consumableRow.Modifier.ModifierLifetime)
      : null,
    byproducts: (consumableRow?.Byproducts ?? [])
      .map((entry) => normalizeRefRowName(entry))
      .filter(Boolean)
  };
}

function extractEquippableDetails(equippableRow) {
  if (!equippableRow) {
    return null;
  }

  return {
    grantedStats: normalizeStatMap(equippableRow?.GrantedStats),
    globalStats: normalizeStatMap(equippableRow?.GlobalStat_GrantedStats),
    appliesInAllInventories: Boolean(equippableRow?.bAppliesInAllInventories),
    diminishingReturns: Boolean(equippableRow?.bStackedModifiersGiveDiminishingReturns)
  };
}

function extractUsableDetails(usableRow) {
  if (!usableRow) {
    return null;
  }

  return {
    uses: (usableRow?.Uses ?? [])
      .map((entry) => normalizeRefRowName(entry?.Use))
      .filter(Boolean),
    alwaysShowContextMenu: Boolean(usableRow?.bAlwaysShowContextMenu)
  };
}

function normalizeStatMap(statsMap) {
  if (!statsMap || typeof statsMap !== "object") {
    return {};
  }

  const entries = Object.entries(statsMap)
    .map(([key, value]) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return null;
      }

      return [key, numericValue];
    })
    .filter(Boolean);

  return Object.fromEntries(entries);
}

function addUnrealPath(out, value) {
  if (typeof value === "string" && value.startsWith("/Game/")) {
    out.add(value);
  }
}

function collectRuntimeAssetReferences(dataJson, sourceLabel) {
  const refs = [];

  const pushRef = (unrealPath, isIcon) => {
    if (typeof unrealPath !== "string" || !unrealPath.startsWith("/Game/")) {
      return;
    }

    refs.push({ unrealPath, sourceLabel, isIcon: Boolean(isIcon) });
  };

  Object.values(dataJson?.ranks ?? {}).forEach((rank) => {
    pushRef(rank?.icon, true);
  });

  Object.values(dataJson?.models ?? {}).forEach((model) => {
    Object.values(model?.archetypes ?? {}).forEach((archetype) => {
      pushRef(archetype?.icon, true);
      pushRef(archetype?.background, false);

      Object.values(archetype?.trees ?? {}).forEach((tree) => {
        pushRef(tree?.icon, true);
        pushRef(tree?.background, false);

        Object.values(tree?.talents ?? {}).forEach((talent) => {
          pushRef(talent?.icon, true);
          pushRef(talent?.itemDetails?.icon, true);
          pushRef(talent?.itemDetails?.glowIcon, true);
        });
      });
    });
  });

  return refs;
}

function summarizeIconCoverage(dataJson) {
  const summary = {
    ranks: 0,
    ranksMissingIcon: 0,
    archetypes: 0,
    archetypesMissingIcon: 0,
    trees: 0,
    treesMissingIcon: 0,
    talents: 0,
    talentsMissingIcon: 0
  };

  Object.values(dataJson?.ranks ?? {}).forEach((rank) => {
    summary.ranks += 1;
    if (!rank?.icon) {
      summary.ranksMissingIcon += 1;
    }
  });

  Object.values(dataJson?.models ?? {}).forEach((model) => {
    Object.values(model?.archetypes ?? {}).forEach((archetype) => {
      summary.archetypes += 1;
      if (!archetype?.icon) {
        summary.archetypesMissingIcon += 1;
      }

      Object.values(archetype?.trees ?? {}).forEach((tree) => {
        summary.trees += 1;
        if (!tree?.icon) {
          summary.treesMissingIcon += 1;
        }

        Object.values(tree?.talents ?? {}).forEach((talent) => {
          summary.talents += 1;

          const hasIcon = Boolean(
            talent?.icon
            || talent?.itemDetails?.icon
            || talent?.itemDetails?.glowIcon
          );

          if (!hasIcon) {
            summary.talentsMissingIcon += 1;
          }
        });
      });
    });
  });

  return summary;
}

function logIconCoverageSummary(label, summary) {
  const lines = [
    `${label} icon coverage:`,
    `  ranks: ${summary.ranks - summary.ranksMissingIcon}/${summary.ranks}`,
    `  archetypes: ${summary.archetypes - summary.archetypesMissingIcon}/${summary.archetypes}`,
    `  trees: ${summary.trees - summary.treesMissingIcon}/${summary.trees}`,
    `  talents: ${summary.talents - summary.talentsMissingIcon}/${summary.talents}`
  ];

  console.log(lines.join("\n"));
}

function collectMissingIconSlots(dataJson, sourceLabel) {
  const entries = [];

  Object.values(dataJson?.models ?? {}).forEach((model) => {
    Object.values(model?.archetypes ?? {}).forEach((archetype) => {
      if (!archetype?.icon) {
        entries.push({
          sourceLabel,
          modelId: model?.id ?? "UnknownModel",
          archetypeId: archetype?.id ?? "UnknownArchetype",
          treeId: "",
          nodeId: "[ArchetypeIcon]"
        });
      }

      Object.values(archetype?.trees ?? {}).forEach((tree) => {
        if (!tree?.icon) {
          entries.push({
            sourceLabel,
            modelId: model?.id ?? "UnknownModel",
            archetypeId: archetype?.id ?? "UnknownArchetype",
            treeId: tree?.id ?? "UnknownTree",
            nodeId: "[TreeIcon]"
          });
        }

        Object.values(tree?.talents ?? {}).forEach((talent) => {
          const hasIcon = Boolean(
            talent?.icon
            || talent?.itemDetails?.icon
            || talent?.itemDetails?.glowIcon
          );

          if (!hasIcon) {
            entries.push({
              sourceLabel,
              modelId: model?.id ?? "UnknownModel",
              archetypeId: archetype?.id ?? "UnknownArchetype",
              treeId: tree?.id ?? "UnknownTree",
              nodeId: talent?.id ?? "UnknownTalent"
            });
          }
        });
      });
    });
  });

  return entries;
}

function renderMissingIconSlotsTree(missingSlots = []) {
  const rootNode = { dirs: new Map(), files: new Set() };

  for (const slot of missingSlots) {
    const parts = [
      slot?.sourceLabel || "UnknownSource",
      slot?.modelId || "UnknownModel",
      slot?.archetypeId || "UnknownArchetype",
      slot?.treeId || "NoTree"
    ];

    let node = rootNode;
    for (const part of parts) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { dirs: new Map(), files: new Set() });
      }
      node = node.dirs.get(part);
    }

    node.files.add(slot?.nodeId || "UnknownNode");
  }

  const lines = ["MissingIconSlots/"];
  appendTreeLines(rootNode, "", lines);
  return lines.join("\n");
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

async function copyReferencedAssets({ sourceContentDir, targetContentDir, assetRefs = [], unrealPaths = [] }) {
  const missingCritical = [];
  const missingOptional = [];
  const missingIcons = [];
  const copiedFiles = [];
  const mergedRefsByRelPath = new Map();
  let copiedCount = 0;

  const normalizedAssetRefs = [
    ...assetRefs,
    ...unrealPaths.map((unrealPath) => ({ unrealPath, sourceLabel: "Runtime", isIcon: true }))
  ];

  for (const ref of normalizedAssetRefs) {
    const unrealPath = ref?.unrealPath;
    const relPngPath = unrealToRelativePngPath(unrealPath);
    if (!relPngPath) {
      continue;
    }

    if (!mergedRefsByRelPath.has(relPngPath)) {
      mergedRefsByRelPath.set(relPngPath, {
        relPngPath,
        unrealPaths: new Set(),
        sourceLabels: new Set(),
        isIcon: false
      });
    }

    const merged = mergedRefsByRelPath.get(relPngPath);
    merged.unrealPaths.add(unrealPath);
    if (ref?.sourceLabel) {
      merged.sourceLabels.add(ref.sourceLabel);
    }
    if (ref?.isIcon) {
      merged.isIcon = true;
    }
  }

  for (const merged of mergedRefsByRelPath.values()) {
    const relPngPath = merged.relPngPath;

    const sourcePath = path.join(sourceContentDir, relPngPath);
    const targetPath = path.join(targetContentDir, relPngPath);

    if (!(await pathExists(sourcePath))) {
      const anyCritical = [...merged.unrealPaths].some((unrealPath) => isCriticalAssetPath(unrealPath));

      if (anyCritical) {
        missingCritical.push(relPngPath);
      } else {
        missingOptional.push(relPngPath);
      }

      if (merged.isIcon) {
        missingIcons.push({
          relPngPath,
          sources: [...merged.sourceLabels].sort((left, right) => left.localeCompare(right))
        });
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
    missingIcons,
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

function renderMissingIconsTree(missingIcons = []) {
  const rootNode = { dirs: new Map(), files: new Set() };

  for (const iconEntry of missingIcons) {
    const cleanPath = iconEntry?.relPngPath?.split(path.sep).join("/");
    if (!cleanPath) {
      continue;
    }

    const sourceSuffix = Array.isArray(iconEntry.sources) && iconEntry.sources.length > 0
      ? ` [${iconEntry.sources.join(", ")}]`
      : "";
    const parts = cleanPath.split("/").filter(Boolean);
    const fileName = parts.pop();

    let node = rootNode;
    for (const part of parts) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { dirs: new Map(), files: new Set() });
      }
      node = node.dirs.get(part);
    }

    if (fileName) {
      node.files.add(`${fileName}${sourceSuffix}`);
    }
  }

  const lines = ["MissingIcons/"];
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
