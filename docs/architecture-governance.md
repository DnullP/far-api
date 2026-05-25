# far-api architecture and governance

This project follows the same boundary shape as ofive, scaled down for an API workbench.

## Project boundaries

- `layout-v2` owns workbench layout behavior: activity bars, sidebars, panel/tab containers, drag/drop, split state, and layout persistence primitives.
- `far-api/src/host/**` owns frontend host infrastructure: registries, workbench contribution bootstrap, shell-level actions, and future command/event bus plumbing.
- `far-api/src/components/**` owns feature UI only. Components should not import raw Tauri APIs or register themselves directly in `App.tsx`.
- `far-api/src/api/**` is the only frontend boundary that can import `@tauri-apps/api/**` or know raw Tauri command IDs.
- `far-api/src/services/**` owns frontend product services and DTO normalization. Services call `src/api/**`, not Tauri directly.
- `far-api/src/store/**` is the current app state owner. Shared state should have one owner before being exposed to panels/tabs.
- `far-api/src-tauri/src/host/**` owns Tauri command wrappers and command registry checks.
- `far-api/src-tauri/src/app/**` owns backend use-case orchestration.
- `far-api/src-tauri/src/shared/**` owns stable frontend/backend payload contracts.
- `far-api/src-tauri/src/db.rs` owns SQLite connection lifecycle and migrations.

## Frontend extension workflow

1. Add feature UI under `src/components/**` or a future `src/plugins/<feature>/**`.
2. Register activity, panel, or tab surface through `src/host/registry/**`.
3. Add built-in contributions in `src/host/contributions/workbenchContributions.tsx`.
4. Add backend calls through `src/api/commandIds.ts` plus a service wrapper.
5. Keep `src/App.tsx` as shell assembly only.

## Backend extension workflow

1. Define stable payloads under `src-tauri/src/shared/**` when frontend and backend both consume them.
2. Put use-case orchestration under `src-tauri/src/app/<module>/**`.
3. Put Tauri wrappers under `src-tauri/src/host/commands/**`.
4. Declare command IDs next to the command owner.
5. Wire the module through `backend_module_manifest.rs`.
6. Keep `host::command_registry::validate_registered_commands()` passing.

## Guards

Run:

```bash
bun run check:guards
```

The guard currently blocks:

- raw `@tauri-apps/api` imports outside `src/api/**`;
- workbench business surfaces imported directly by `src/App.tsx`;
- frontend command IDs that drift from Rust command contributions;
- `layout-v2` usage that does not build the local latest package first;
- Tauri command definitions in `src-tauri/src/lib.rs`;
- startup missing backend contribution or command registry validation.

## Next hardening steps

- Move collection/environment/history SQL from command modules into `app/workspace` and `app/history` services.
- Add app event bus and request execution events before implementing Runner, monitors, or scripts.
- Split `AppStateProvider` into workspace-data, runtime-tab, and request-execution stores once the next feature requires independent ownership.
- Add import/export contracts before adding cloud/team collaboration surfaces.
