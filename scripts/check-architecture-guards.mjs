import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function walk(dir, predicate = () => true) {
    const entries = [];
    for (const name of readdirSync(dir)) {
        const fullPath = path.join(dir, name);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            if (name === "node_modules" || name === "dist" || name === "target") {
                continue;
            }
            entries.push(...walk(fullPath, predicate));
            continue;
        }
        if (predicate(fullPath)) {
            entries.push(fullPath);
        }
    }
    return entries;
}

function read(relativePath) {
    return readFileSync(path.join(root, relativePath), "utf8");
}

function toRelative(fullPath) {
    return path.relative(root, fullPath).split(path.sep).join("/");
}

function fail(message) {
    violations.push(message);
}

function extractStringLiterals(source) {
    return Array.from(source.matchAll(/["']([^"']+)["']/g), (match) => match[1]);
}

const violations = [];

const packageJson = JSON.parse(read("package.json"));
if (packageJson.dependencies?.["layout-v2"] !== "file:../layout-v2") {
    fail("package.json must consume the local latest layout-v2 with \"file:../layout-v2\".");
}
for (const scriptName of ["dev", "build", "test"]) {
    const script = packageJson.scripts?.[scriptName] ?? "";
    if (!script.includes("build:layout-v2")) {
        fail(`package.json script "${scriptName}" must run build:layout-v2 first.`);
    }
}

for (const file of walk(path.join(root, "src"), (entry) => /\.(ts|tsx)$/.test(entry))) {
    const relativePath = toRelative(file);
    const source = readFileSync(file, "utf8");
    if (source.includes("@tauri-apps/api") && !relativePath.startsWith("src/api/")) {
        fail(`${relativePath}: raw @tauri-apps/api imports must stay inside src/api/**.`);
    }
}

const appSource = read("src/App.tsx");
for (const forbiddenImport of [
    "./components/CollectionsPanel",
    "./components/EnvironmentPanel",
    "./components/HistoryPanel",
    "./components/RequestEditor",
    "./components/WelcomeTab",
]) {
    if (appSource.includes(forbiddenImport)) {
        fail(`src/App.tsx must consume workbench registry contributions, not import ${forbiddenImport}.`);
    }
}

const commandIdSource = read("src/api/commandIds.ts");
const frontendCommandIds = new Set(
    extractStringLiterals(commandIdSource).filter((value) => /^[a-z_]+$/.test(value)),
);
const rustCommandIds = new Set();
for (const file of walk(path.join(root, "src-tauri/src"), (entry) => entry.endsWith(".rs"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/COMMAND_IDS:\s*&\[&str\]\s*=\s*&\[(?<body>[\s\S]*?)\];/g)) {
        for (const value of extractStringLiterals(match.groups.body)) {
            rustCommandIds.add(value);
        }
    }
}
for (const commandId of frontendCommandIds) {
    if (!rustCommandIds.has(commandId)) {
        fail(`src/api/commandIds.ts declares "${commandId}" but Rust command contributions do not.`);
    }
}
for (const commandId of rustCommandIds) {
    if (!frontendCommandIds.has(commandId)) {
        fail(`Rust command contributions declare "${commandId}" but src/api/commandIds.ts does not.`);
    }
}

const rustLibSource = read("src-tauri/src/lib.rs");
if (rustLibSource.includes("#[tauri::command]")) {
    fail("src-tauri/src/lib.rs must stay a bootstrap file; Tauri commands belong in host/commands or module-owned command files.");
}
if (!rustLibSource.includes("validate_builtin_backend_module_contributions()")) {
    fail("src-tauri/src/lib.rs must validate backend module contributions during startup.");
}
if (!rustLibSource.includes("validate_registered_commands()")) {
    fail("src-tauri/src/lib.rs must validate command registry/contribution alignment during startup.");
}

if (violations.length > 0) {
    console.error("[architecture-guard] failed:");
    for (const violation of violations) {
        console.error(`  - ${violation}`);
    }
    process.exit(1);
}

console.info("[architecture-guard] passed");
