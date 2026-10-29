import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@babel/core";
import typescriptPreset from "@babel/preset-typescript";
import solidPreset from "babel-preset-solid";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(file)));
    else files.push(file);
  }
  return files;
}

const files = (await walk(dist)).filter((file) => file.endsWith(".jsx"));
for (const sourcePath of files) {
  const source = await fs.readFile(sourcePath, "utf8");
  const transformed = await babel.transformAsync(source, {
    filename: sourcePath,
    configFile: false,
    babelrc: false,
    presets: [
      [solidPreset, { moduleName: "@opentui/solid", generate: "universal" }],
      [typescriptPreset]
    ]
  });

  if (!transformed?.code) {
    throw new Error(`Babel transform returned empty output for ${sourcePath}`);
  }

  const outputPath = sourcePath.slice(0, -".jsx".length) + ".js";
  await fs.writeFile(outputPath, `${transformed.code}\n`);
  await fs.rm(sourcePath, { force: true });
  await fs.rm(`${sourcePath}.map`, { force: true });
  await fs.rm(`${outputPath}.map`, { force: true });
}
