# Feature Suggestion: `codegraph_file_symbols` — List all symbols in a single file

## Why

CodeGraph's existing tools excel at relationship queries (callers, callees, explore flow), but there's no way to answer the most basic question: **"What's in this file?"**

Before editing a large file, I need to quickly scan its structure — which functions, methods, classes, and variables it contains, and at what lines. Currently this requires either:

- A full `Read` of the file (expensive in context/AI tokens)
- Multiple `codegraph_explore` calls (impractical for an overview)
- Falling back to `grep def_` outside the MCP ecosystem

All the data is already in the SQLite index (`getNodesInFile` exists). We just need a tool to surface it.

## Tool definition

```js
{
    name: 'codegraph_file_symbols',
    description: 'List all symbols (functions, classes, methods, variables) in a single file. Returns name, kind, line range, and kind summary.',
    inputSchema: {
        type: 'object',
        properties: {
            file: {
                type: 'string',
                description: 'File path relative to project root (e.g., "src/main.ts", "xrviewer.py")',
            },
            kind: {
                type: 'string',
                description: 'Optional filter by node kind',
                enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
            },
            projectPath: projectPathProperty,
        },
        required: ['file'],
    },
}
```

## Output format

```
Symbols in src/main.ts (42 total):

     1-1       file        main.ts
     8-8       import      fs
    10-10      class       Config
    12-18      method      load
    20-35      function    main
    38-38      variable    DEFAULT_PORT
    ...

--- By kind ---
  function: 15
  class: 5
  variable: 8
  import: 12
  file: 1
```

Filtered by kind:

```
Symbols in xrviewer.py (48 functions):

    58-74      function    _read_glb_chunks
    83-111     function    _get_accessor
    ...
```

## Implementation

Three small additions to `tools.js`:

### 1. Tool definition in `exports.tools` array

Standard input schema with `file` (required) + optional `kind` filter + `projectPath`.

### 2. Switch case in `execute()`

```js
case 'codegraph_file_symbols':
    result = await this.handleFileSymbols(args);
    break;
```

### 3. Handler method

```js
async handleFileSymbols(args) {
    const file = this.validateString(args.file, 'file');
    if (typeof file !== 'string') return file;
    const cg = this.getCodeGraph(args.projectPath);
    const kindFilter = args.kind;
    const nodes = cg.getNodesInFile(file);
    if (nodes.length === 0) {
        return this.textResult(`No symbols found in "${file}".`);
    }
    const filtered = kindFilter ? nodes.filter(n => n.kind === kindFilter) : nodes;
    if (filtered.length === 0) {
        return this.textResult(`No symbols of kind "${kindFilter}" in "${file}".`);
    }
    const sorted = filtered.sort((a, b) => a.startLine - b.startLine);
    const lines = [`Symbols in ${file} (${sorted.length} total):`, ''];
    const kinds = {};
    for (const n of sorted) {
        const kind = n.kind || '?';
        kinds[kind] = (kinds[kind] || 0) + 1;
        lines.push(`${n.startLine.toString().padStart(6)}-${n.endLine.toString().padEnd(6)}  ${kind.padEnd(10)}  ${n.name}`);
    }
    lines.push('', '--- By kind ---');
    for (const [k, c] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${k}: ${c}`);
    }
    return this.textResult(this.truncateOutput(lines.join('\n')));
}
```

### 4. Register in `TINY_REPO_CORE_TOOLS` (projects < 500 files)

```js
const TINY_REPO_CORE_TOOLS = new Set([
    'codegraph_explore',
    'codegraph_search',
    'codegraph_node',
    'codegraph_file_symbols',  // ← add here
]);
```

## Usage

```
codegraph_file_symbols file="xrviewer.py"
codegraph_file_symbols file="src/main.ts" kind=function
```

---

**TODO:** Open a PR or issue at https://github.com/colbymchenry/codegraph
