/**
 * Reads the game export data files and outputs a newline-delimited list of
 * uasset paths that need to be decoded as textures by the exporter.
 *
 * Usage:
 *   node scripts/assets.mjs [gameExportDir] [outputFile]
 *
 * gameExportDir defaults to ../../Exports (relative to this script).
 * outputFile defaults to ../../Exports/texture-list.txt.
 *
 * Output format: one path per line, e.g.
 *   Icarus/Content/Assets/2DArt/UI/Talents/Foo.uasset
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { runPreflight } from "../src/preflight.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXTRA_RUNTIME_ASSET_PATHS = [
  "/Game/Assets/2DArt/UI/Icons/Icon_Solo.Icon_Solo",
  "/Game/Assets/2DArt/UI/Icons/T_ICON_Paws.T_ICON_Paws",
  "/Game/Assets/2DArt/UI/Icons/T_Icon_TechTree.T_Icon_TechTree",
  "/Game/Assets/2DArt/UI/Icons/Icon_RenCurrency.Icon_RenCurrency",
  "/Game/Assets/2DArt/UI/Icons/Icon_Speed.Icon_Speed",
  "/Game/Assets/2DArt/UI/Icons/Icon_AggressiveCreature.Icon_AggressiveCreature",
  "/Game/Assets/2DArt/UI/Icons/T_Icon_Homestead.T_Icon_Homestead",
  "/Game/Assets/2DArt/UI/Icons/Padlock_Symbol.Padlock_Symbol",
  "/Game/Assets/2DArt/UI/Icons/T_Icon_Star.T_Icon_Star",
  "/Game/Assets/2DArt/UI/Tech_Tree/BlueprintCount_Locked_Normal.BlueprintCount_Locked_Normal",
  "/Game/Assets/2DArt/UI/Tech_Tree/BlueprintCount_Unlocked_Normal.BlueprintCount_Unlocked_Normal",
  "/Game/Assets/2DArt/UI/Tech_Tree/BlueprintCount_Available_Normal.BlueprintCount_Available_Normal",
  "/Game/Assets/2DArt/UI/Icons/T_FeatureLevelIcon_NewFrontiers3.T_FeatureLevelIcon_NewFrontiers3",
  "/Game/Assets/2DArt/UI/Icons/FeatureLevel/T_FeatureLevel_GH.T_FeatureLevel_GH",
  "/Game/Assets/2DArt/UI/Icons/FeatureLevel/T_FeatureLevel_DH.T_FeatureLevel_DH",
  "/Game/Assets/2DArt/UI/Icons/T_ICON_Money_Symbol_Double.T_ICON_Money_Symbol_Double",
];

function unrealPathToUasset(unrealPath) {
  if (!unrealPath?.startsWith("/Game/")) return null;
  const withoutGame = unrealPath.slice("/Game/".length);
  const packagePath = withoutGame.split(".")[0];
  if (!packagePath) return null;
  return `Icarus/Content/${packagePath}.uasset`;
}

// Collect every /Game/ string found anywhere in the data — field names vary
// between the raw CUE4Parse JSON (PascalCase) and the transform output.
function collectPaths(obj, out) {
  if (typeof obj === "string") {
    if (obj.startsWith("/Game/")) out.add(obj);
    return;
  }
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectPaths(item, out);
    return;
  }
  for (const value of Object.values(obj)) {
    collectPaths(value, out);
  }
}

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const gameExportDir = path.resolve(
    __dirname,
    process.argv[2] ?? "../../Exports"
  );
  const outputFile = path.resolve(
    __dirname,
    process.argv[3] ?? "../../Exports/texture-list.txt"
  );

  await runPreflight({ exportDir: gameExportDir });

  const dataFiles = [
    path.join(gameExportDir, "Talents/D_TalentRanks.json"),
    path.join(gameExportDir, "Talents/D_TalentModels.json"),
    path.join(gameExportDir, "Talents/D_TalentArchetypes.json"),
    path.join(gameExportDir, "Talents/D_TalentTrees.json"),
    path.join(gameExportDir, "Talents/D_Talents.json"),
    path.join(gameExportDir, "Talents/D_PlayerTalentModifiers.json"),
    path.join(gameExportDir, "Traits/D_Itemable.json"),
    path.join(gameExportDir, "AI/D_Mounts.json"),
    path.join(gameExportDir, "Development/D_FeatureLevels.json"),
    path.join(gameExportDir, "DLC/D_DLCPackageData.json"),
  ];

  const unrealPaths = new Set(EXTRA_RUNTIME_ASSET_PATHS);

  for (const filePath of dataFiles) {
    const data = await readJsonOptional(filePath);
    if (data) {
      collectPaths(data, unrealPaths);
    }
  }

  const uassetPaths = [...unrealPaths]
    .map(unrealPathToUasset)
    .filter(Boolean)
    .sort();

  await fs.writeFile(outputFile, uassetPaths.join("\n") + "\n", "utf8");

  console.log(`Wrote ${uassetPaths.length} texture paths to ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
