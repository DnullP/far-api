# far-api Postman-aligned commercial baseline

Sources checked on 2026-05-25:

- Postman collections docs: https://learning.postman.com/docs/collections/collections-overview
- Postman docs overview: https://learning.postman.com/docs/
- Postman test scripts docs: https://learning.postman.com/docs/writing-scripts/test-scripts/
- Postman product feature page: https://www.postman.com/features

## Baseline product pillars

| Pillar | Commercial baseline | Current status |
| --- | --- | --- |
| API client | Send REST requests, inspect status/headers/body/timing/size, support params/headers/body editing | Basic REST done |
| Collections | Collections, folders, request CRUD, ordering, duplicate/import/export | Collection/request CRUD, persistent folders, folder/request move, OpenAPI/Swagger/Postman JSON import, Postman v2.1 JSON export, and cURL import done; duplicate/search pending |
| Environments | Variables, active environment, secret masking, scoped overrides | Basic variables and Postman environment export done; secret handling/scopes pending |
| History | Durable request history with replay, search, clear/delete | Basic durable history done; replay/search pending |
| Auth | No auth, API key, Bearer, Basic, OAuth 2, inheritance | Request-level none/API key/Bearer/Basic done; inheritance/OAuth 2 pending |
| Scripts/tests | Pre-request and post-response scripts, assertions, variable mutation | Request-level pre/post scripts, basic pm API, assertions, logs, and runtime variable mutation done |
| Runner | Run a collection/folder with iterations, data files, reports | Manual collection/folder runner with iterations and persisted local reports done; data files pending |
| Protocols | REST first, then GraphQL, gRPC/WebSocket/RPC | REST active; GraphQL/RPC placeholders |
| Documentation | Generate/share local docs from collections and examples | Pending |
| Mock servers | Mock responses from examples locally | Pending |
| Monitors | Scheduled collection runs and alerts | Pending |
| Import/export | Postman collection v2.1, OpenAPI, cURL, HAR | OpenAPI/Swagger/Postman JSON import, Postman collection/environment export, and cURL import done; HAR pending |
| Team/commercial | Workspace governance, safe storage, backup, audit trail | Pending |

## MVP to reach basic commercial quality

1. Finish local-first REST quality: folders, duplicate, search, import/export, request replay from history.
2. Add auth helpers with inheritance from collection to request.
3. Add secret-aware environment variables and masked display/copy behavior.
4. Add Postman collection v2.1 import/export and cURL import. Done for collection import/export and cURL import; environment export done; environment import pending.
5. Add lightweight test script runner for response assertions and environment mutation. Done for request-level scripts; persistence of mutated environment values pending.
6. Add collection runner with report output. Manual run and persisted local report history done; data files pending.
7. Add local documentation generation from collections and examples.
8. Add local mock server for saved examples.
9. Add GraphQL request surface using the existing `protocol-graphql` contribution.
10. Add monitor automation only after scripts and runner have stable contracts.

## Architecture rule for every new pillar

Every pillar must land through the same path:

1. frontend contribution or component;
2. frontend service/API wrapper;
3. shared backend contract if needed;
4. backend app service;
5. host command wrapper;
6. module contribution/command registry validation;
7. guard or focused regression test.
