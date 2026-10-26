import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectory = join(projectDirectory, "migrations");
const destinationDirectory = join(projectDirectory, "dist", "migrations");

await mkdir(destinationDirectory, { recursive: true });
const migrationFiles = (await readdir(sourceDirectory)).filter((file) =>
  /^\d+_[a-z0-9_-]+\.sql$/.test(file),
);
for (const file of migrationFiles) {
  await copyFile(
    join(sourceDirectory, file),
    join(destinationDirectory, file),
  );
}
