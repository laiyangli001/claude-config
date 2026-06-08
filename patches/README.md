# Patches

## codegraph-file-symbols

Adds `codegraph_file_symbols` tool to CodeGraph MCP — lists all symbols
(functions, classes, methods, variables) in a single file with line numbers.

### Files

| File | Purpose |
|------|---------|
| `codegraph-file-symbols.mjs` | Apply script — re-injects the tool into `tools.js` |
| `package.json` | `postinstall` hook runs the script automatically after `npm install` |

### Manual apply

```bash
node patches/codegraph-file-symbols.mjs
```

Then Reload Window (`Ctrl+Shift+P` → `Developer: Reload Window`).

### Config note

`.claude.json` MCP entry for codegraph must use absolute path —
`"node C:\\Users\\LaiYangLi\\.claude\\node_modules\\@colbymchenry\\codegraph\\npm-shim.js"`
— rather than bare `codegraph`, which is not in `PATH`.
