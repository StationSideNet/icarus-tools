import fs from "fs/promises";
import path from "path";

/**
 * All JSON (and INI) files the transform pipeline requires.
 * Paths are relative to the game export directory (e.g. Exports/).
 * A missing file here means the transform cannot produce correct output.
 */
export const REQUIRED_JSON = [
  "Talents/D_TalentRanks.json",
  "Talents/D_TalentModels.json",
  "Talents/D_TalentArchetypes.json",
  "Talents/D_TalentTrees.json",
  "Talents/D_Talents.json",
  "Talents/D_PlayerTalentModifiers.json",
  "Icarus/Config/DefaultGame.ini",
  "Icarus/Content/Localization/Game/Game.json",
  "Traits/D_Itemable.json",
  "Items/D_ItemsStatic.json",
  "Traits/D_Equippable.json",
  "Crafting/D_ProcessorRecipes.json",
  "Traits/D_Durable.json",
  "Traits/D_Buildable.json",
  "Traits/D_Deployable.json",
  "Traits/D_Consumable.json",
  "Traits/D_Usable.json",
  "Traits/D_Armour.json",
  "Crafting/D_RecipeSets.json",
  "AI/D_Mounts.json",
  "Flags/D_AccountFlags.json",
  "Development/D_FeatureLevels.json",
  "DLC/D_DLCPackageData.json",
];

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check that all required JSON inputs are present in exportDir.
 * Prints a one-line summary and lists any missing files.
 *
 * @param {{ exportDir: string, exitOnFail?: boolean }} opts
 * @returns {Promise<boolean>} true if all present, false if any missing
 */
export async function runPreflight({ exportDir, exitOnFail = true }) {
  const missing = [];

  for (const rel of REQUIRED_JSON) {
    if (!(await pathExists(path.join(exportDir, rel)))) {
      missing.push(rel);
    }
  }

  const total = REQUIRED_JSON.length;
  const present = total - missing.length;

  if (missing.length === 0) {
    console.log(`✅ JSON inputs (${total}/${total}): all present`);
    return true;
  }

  console.error(`❌ JSON inputs (${present}/${total}): ${missing.length} missing`);
  for (const rel of missing) {
    console.error(`     ${rel}`);
  }
  console.error("❌ Validation failed. Run the exporter first.");

  if (exitOnFail) {
    process.exit(1);
  }

  return false;
}
