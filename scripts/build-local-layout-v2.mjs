import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * Build the workspace layout-v2 package and make far-api consume that exact
 * local source tree, so dev/build/test always use the latest local layout-v2.
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const defaultLayoutV2Root = path.resolve(repoRoot, "..", "layout-v2");

function readPackageJson(filePath) {
    return JSON.parse(readFileSync(filePath, "utf8"));
}

function readLayoutV2DependencySpec(packageJson) {
    return packageJson.dependencies?.["layout-v2"]
        ?? packageJson.devDependencies?.["layout-v2"]
        ?? packageJson.peerDependencies?.["layout-v2"]
        ?? null;
}

function resolveLocalDependencyPath(spec) {
    if (typeof spec !== "string") {
        return null;
    }

    if (spec.startsWith("file:")) {
        return path.resolve(repoRoot, spec.slice("file:".length));
    }

    if (spec.startsWith("link:")) {
        return path.resolve(repoRoot, spec.slice("link:".length));
    }

    return null;
}

function hasLayoutV2Dependencies(layoutRoot) {
    return existsSync(path.join(layoutRoot, "node_modules", "typescript"))
        && existsSync(path.join(layoutRoot, "node_modules", "vite"));
}

function installLayoutV2Dependencies(layoutRoot) {
    console.info("[layout-v2-build] installing dependencies", { layoutRoot });

    const result = spawnSync("bun", ["install"], {
        cwd: layoutRoot,
        stdio: "inherit",
        env: process.env,
    });

    if (typeof result.status === "number" && result.status !== 0) {
        process.exit(result.status);
    }

    if (result.error) {
        throw result.error;
    }
}

function ensureLayoutV2Source(layoutRoot) {
    const packageJson = path.join(layoutRoot, "package.json");
    if (!existsSync(packageJson)) {
        throw new Error(`layout-v2 local dependency is missing package.json: ${packageJson}`);
    }
}

function pathsReferToSameLocation(firstPath, secondPath) {
    try {
        const firstRealPath = realpathSync.native(firstPath);
        const secondRealPath = realpathSync.native(secondPath);
        return process.platform === "win32"
            ? firstRealPath.toLowerCase() === secondRealPath.toLowerCase()
            : firstRealPath === secondRealPath;
    } catch {
        return false;
    }
}

function removeExistingLayoutV2Module(modulePath) {
    if (!existsSync(modulePath)) {
        return;
    }

    const existingStats = lstatSync(modulePath);
    if (!existingStats.isDirectory() && !existingStats.isSymbolicLink()) {
        throw new Error(`node_modules/layout-v2 exists but is not a directory or symlink: ${modulePath}`);
    }

    rmSync(modulePath, { recursive: true, force: true });
}

function ensureLayoutV2NodeModuleLink(layoutRoot) {
    const nodeModulesRoot = path.join(repoRoot, "node_modules");
    const modulePath = path.join(nodeModulesRoot, "layout-v2");
    if (pathsReferToSameLocation(modulePath, layoutRoot)) {
        return;
    }

    removeExistingLayoutV2Module(modulePath);
    mkdirSync(nodeModulesRoot, { recursive: true });

    const linkType = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(layoutRoot, modulePath, linkType);
    console.info("[layout-v2-build] linked local dependency", { modulePath, layoutRoot });
}

function buildLayoutV2(layoutRoot) {
    ensureLayoutV2NodeModuleLink(layoutRoot);

    if (!hasLayoutV2Dependencies(layoutRoot)) {
        installLayoutV2Dependencies(layoutRoot);
    }

    console.info("[layout-v2-build] start", { layoutRoot });

    const result = spawnSync("bun", ["run", "build"], {
        cwd: layoutRoot,
        stdio: "inherit",
        env: process.env,
    });

    if (typeof result.status === "number" && result.status !== 0) {
        process.exit(result.status);
    }

    if (result.error) {
        throw result.error;
    }

    console.info("[layout-v2-build] success", { layoutRoot });
}

const packageJson = readPackageJson(packageJsonPath);
const dependencySpec = readLayoutV2DependencySpec(packageJson);
const layoutRoot = resolveLocalDependencyPath(dependencySpec) ?? defaultLayoutV2Root;

ensureLayoutV2Source(layoutRoot);
buildLayoutV2(layoutRoot);
