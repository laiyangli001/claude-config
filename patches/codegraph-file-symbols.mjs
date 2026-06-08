/**
 * Apply codegraph_file_symbols tool patch to @colbymchenry/codegraph
 *
 * After `npm install` reinstalls @colbymchenry/codegraph, the
 * tools.js in dist/ is overwritten. Run this script to re-inject
 * the codegraph_file_symbols tool.
 *
 * Usage: node patches/codegraph-file-symbols.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Locate tools.js (win32-x64 or other platform)
const patterns = [
  'node_modules/@colbymchenry/codegraph-win32-x64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph-win32-arm64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph-darwin-arm64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph-darwin-x64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph-linux-arm64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph-linux-x64/lib/dist/mcp/tools.js',
];

let toolsPath;
for (const p of patterns) {
  const full = resolve(root, p);
  if (existsSync(full)) { toolsPath = full; break; }
}
if (!toolsPath) {
  console.error('tools.js not found. Is codegraph installed?');
  process.exit(1);
}

let src = readFileSync(toolsPath, 'utf-8');
let dirty = false;

// ── 1. Tool definition ──
// Insert after the 'codegraph_files' tool definition (before the closing brace of that entry)
const toolDef = `    {
        name: 'codegraph_file_symbols',
        description: 'List all symbols (functions, classes, methods, variables) in a single file. Returns name, kind, and line range.',
        inputSchema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    description: 'File path relative to project root (e.g., "src/main.ts")',
                },
                kind: {
                    type: 'string',
                    description: 'Filter by node kind',
                    enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
                },
                projectPath: projectPathProperty,
            },
            required: ['file'],
        },
    },`;

if (!src.includes("'codegraph_file_symbols'")) {
  // Find the end of codegraph_files tool definition and insert after it
  const marker = `projectPath: projectPathProperty,
            },
        },
    },
    {`;
  const insertPos = src.indexOf(marker);
  if (insertPos === -1) {
    console.error('Could not find insertion point for tool definition.');
    process.exit(1);
  }
  // Insert after the closing `},` of codegraph_files
  const afterFilesDef = insertPos + marker.length;
  src = src.slice(0, afterFilesDef) + '\n' + toolDef + src.slice(afterFilesDef);
  dirty = true;
  console.log('  ✓ Tool definition inserted');
}

// ── 2. TINY_REPO_CORE_TOOLS ──
if (!src.includes("'codegraph_file_symbols'") && src.includes('codegraph_node')) {
  // Should have been inserted above, but check the TINY_REPO set separately
  src = src.replace(
    /('codegraph_node',)\s*\n/,
    `$1\n                'codegraph_file_symbols',\n`
  );
  dirty = true;
  console.log('  ✓ TINY_REPO_CORE_TOOLS updated');
}
// Actually check if it's already there
if (src.includes("'codegraph_file_symbols'") && !src.includes('codegraph_file_symbols', src.indexOf('TINY_REPO_CORE_TOOLS'))) {
  src = src.replace(
    /('codegraph_node',)\s*\n/,
    `$1\n                'codegraph_file_symbols',\n`
  );
  dirty = true;
  console.log('  ✓ TINY_REPO_CORE_TOOLS updated');
}

// ── 3. Switch case ──
const switchCase = `                case 'codegraph_file_symbols':
                    result = await this.handleFileSymbols(args);
                    break;`;

if (!src.includes("case 'codegraph_file_symbols'")) {
  const afterStatus = `case 'codegraph_status':`;
  const beforeFilesCase = `                case 'codegraph_files':`;
  // Find the codegraph_files case and insert before it
  const insertBefore = src.indexOf(beforeFilesCase);
  if (insertBefore === -1) {
    console.error('Could not find insertion point for switch case.');
    process.exit(1);
  }
  src = src.slice(0, insertBefore) + switchCase + '\n' + src.slice(insertBefore);
  dirty = true;
  console.log('  ✓ Switch case inserted');
}

// ── 4. Handler method ──
const handler = `    /**
     * Handle codegraph_file_symbols — list all symbols in a single file
     */
    async handleFileSymbols(args) {
        const file = this.validateString(args.file, 'file');
        if (typeof file !== 'string')
            return file;
        const cg = this.getCodeGraph(args.projectPath);
        const kindFilter = args.kind;
        const nodes = cg.getNodesInFile(file);
        if (nodes.length === 0) {
            return this.textResult(\`No symbols found in "\${file}". The file may not be indexed or the path may be wrong.\`);
        }
        const filtered = kindFilter ? nodes.filter(n => n.kind === kindFilter) : nodes;
        if (filtered.length === 0) {
            return this.textResult(\`No symbols of kind "\${kindFilter}" found in "\${file}".\`);
        }
        // Sort by start line
        const sorted = filtered.sort((a, b) => a.startLine - b.startLine);
        const lines = [\`Symbols in \${file} (\${sorted.length} total):\`, ''];
        const kinds = {};
        for (const n of sorted) {
            const kind = n.kind || '?';
            kinds[kind] = (kinds[kind] || 0) + 1;
            lines.push(\`\${n.startLine.toString().padStart(6)}-\${n.endLine.toString().padEnd(6)}  \${kind.padEnd(10)}  \${n.name}\`);
        }
        lines.push('', '--- By kind ---');
        for (const [k, c] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
            lines.push(\`  \${k}: \${c}\`);
        }
        return this.textResult(this.truncateOutput(lines.join('\\n')));
    }`;

if (!src.includes('handleFileSymbols(args)')) {
  // Insert before the globToRegex method
  const insertBeforeGlob = src.indexOf('globToRegex(pattern)');
  if (insertBeforeGlob === -1) {
    console.error('Could not find insertion point for handler method.');
    process.exit(1);
  }
  const indent = src.slice(0, insertBeforeGlob).lastIndexOf('\n');
  src = src.slice(0, indent) + '\n' + handler + '\n\n    ' + src.slice(indent);
  dirty = true;
  console.log('  ✓ Handler method inserted');
}

// ── Write back ──
if (dirty) {
  writeFileSync(toolsPath, src, 'utf-8');
  console.log(`\n✅ Patched: ${toolsPath}`);
  console.log('   Reload Window (Ctrl+Shift+P → Developer: Reload Window) to activate.');
} else {
  console.log('\n✅ Already patched — nothing to do.');
}
