/**
 * Full data pipeline for icarus-tools.
 *
 * Steps:
 *   [1/5] Export JSON       — dotnet run in exporter/
 *   [2/5] Validate inputs   — node talent-transform/src/index.mjs --validate
 *   [3/5] Generate asset list — node talent-transform/scripts/assets.mjs
 *   [4/5] Export textures   — dotnet run --no-clean --textures=... (soft step)
 *   [5/5] Transform         — node talent-transform/src/index.mjs
 *
 * Flags:
 *   --no-clean      Pass --no-clean to the exporter (step 1) — skips output dir wipe.
 *   --skip-export   Skip step 1 entirely (JSON already exported).
 *
 * Usage:
 *   node scripts/pipeline.mjs [--no-clean] [--skip-export]
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXPORTS = path.join(ROOT, "Exports");
const TEXTURE_LIST = path.join(EXPORTS, "texture-list.txt");
const EXPORTER_DIR = path.join(ROOT, "exporter");
const TRANSFORM_DIR = path.join(ROOT, "talent-transform");

const args = process.argv.slice(2);
const noClean = args.includes("--no-clean");
const skipExport = args.includes("--skip-export");

const TOTAL_STEPS = 5;

function header(step, label) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[${step}/${TOTAL_STEPS}] ${label}`);
  console.log("─".repeat(60));
}

function run(cmd, cmdArgs, { cwd, soft = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, cmdArgs, { cwd, stdio: "inherit", shell: true });
    proc.on("close", (code) => {
      if (code === 0 || soft) {
        if (code !== 0) {
          console.warn(`\n⚠️  Step exited with code ${code} (non-critical — continuing)`);
        }
        resolve(code);
      } else {
        reject(new Error(`Step failed with exit code ${code}`));
      }
    });
    proc.on("error", reject);
  });
}

async function main() {
  // Step 1: Export JSON
  if (!skipExport) {
    header(1, "Export JSON");
    const exporterArgs = [`--out="${EXPORTS}"`];
    if (noClean) exporterArgs.push("--no-clean");
    await run("dotnet", ["run", "--", ...exporterArgs], { cwd: EXPORTER_DIR });
  } else {
    console.log(`\n[1/${TOTAL_STEPS}] Export JSON — skipped (--skip-export)`);
  }

  // Step 2: Validate JSON inputs
  header(2, "Validate JSON inputs");
  await run("node", ["src/index.mjs", "--validate"], { cwd: TRANSFORM_DIR });

  // Step 3: Generate texture asset list
  header(3, "Generate texture asset list");
  await run("node", ["scripts/assets.mjs"], { cwd: TRANSFORM_DIR });

  // Step 4: Export textures (soft — missing textures degrade icons but don't break pipeline)
  header(4, "Export textures");
  const textureArgs = [`--out="${EXPORTS}"`, `--textures="${TEXTURE_LIST}"`, "--no-clean"];
  await run("dotnet", ["run", "--", ...textureArgs], { cwd: EXPORTER_DIR, soft: true });

  // Step 5: Transform
  header(5, "Transform");
  await run("node", ["src/index.mjs"], { cwd: TRANSFORM_DIR });

  console.log(`\n${"─".repeat(60)}`);
  console.log("✅ Pipeline complete.");
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error(`\n❌ Pipeline aborted: ${err.message}`);
  process.exit(1);
});
