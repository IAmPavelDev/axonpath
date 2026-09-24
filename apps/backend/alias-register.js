// module-alias auto-detection assumes its own copy lives directly under the
// consuming package's node_modules (isolated pnpm layout). Under the hoisted
// linker it resolves to the workspace root package.json, which has no
// `_moduleAliases`, and registers nothing. Register with an explicit base so
// aliases work under either layout.
require("module-alias")({ base: __dirname });
