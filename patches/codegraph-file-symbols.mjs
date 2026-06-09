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

// Locate tools.js — supports both old (platform-pkg) and new (single-pkg) layouts
const patterns = [
  'node_modules/@colbymchenry/codegraph-win32-x64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph-win32-arm64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph-darwin-arm64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph-darwin-x64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph-linux-arm64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph-linux-x64/lib/dist/mcp/tools.js',
  'node_modules/@colbymchenry/codegraph/dist/mcp/tools.js',
];

let toolsPath;
for (const p of patterns) {
  const full = resolve(root, p);
  if (existsSync(full)) { toolsPath = full; break; }
}
if (!toolsPath) {
  console.log('tools.js not found — codegraph may not be installed. Skipping.');
  process.exit(0);
}

let src = readFileSync(toolsPath, 'utf-8');
let dirty = false;

// ── 1. Check if already patched ──
// If the tool definition already exists in the tools array, skip everything.
if (src.includes("name: 'codegraph_file_symbols'")) {
  console.log('  ✓ codegraph_file_symbols already present — nothing to do.');
  process.exit(0);
}

// ── 2. Tool definition ──
// Insert after the closing `},` of the last tool in the tools array.
// Find `codegraph_status`, which is the last tool, and insert before its closing `},`
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

// Find the last tool entry by looking for codegraph_status closing brace
const statusEnd = '    {';
const lastToolPos = src.lastIndexOf(statusEnd);
if (lastToolPos === -1) {
  console.error('Could not find insertion point for tool definition.');
  process.exit(1);
}
// Insert toolDef before the last `{` which starts the status tool
src = src.slice(0, lastToolPos) + toolDef + '\n' + src.slice(lastToolPos);
dirty = true;
console.log('  ✓ Tool definition inserted');

// ── 3. TINY_REPO_CORE_TOOLS ──
// Add codegraph_file_symbols to the tiny-repo set
const tinyRepoSrc = "            const TINY_REPO_CORE_TOOLS = new Set([";
const tinyRepoIdx = src.indexOf(tinyRepoSrc);
if (tinyRepoIdx === -1) {
  console.error('Could not find TINY_REPO_CORE_TOOLS set.');
  process.exit(1);
}
// Find the closing bracket of the Set to insert before it
const closerIdx = src.indexOf('            ]);', tinyRepoIdx);
if (closerIdx === -1) {
  console.error('Could not find TINY_REPO_CORE_TOOLS closing bracket.');
  process.exit(1);
}
const indent = '                ';
const insertLine = `\n${indent}'codegraph_file_symbols',\n`;
src = src.slice(0, closerIdx) + insertLine + src.slice(closerIdx);
// Clean up: remove blank line before `]);` if present
src = src.replace(/\n\s*\n\s*\];\)/, '\n            ]);');
dirty = true;
console.log('  ✓ TINY_REPO_CORE_TOOLS updated');

// ── 4. Switch case ──
// Insert before the `case 'codegraph_files':` line
const switchCase = `                case 'codegraph_file_symbols':
                    result = await this.handleFileSymbols(args);
                    break;`;

const filesCase = "                case 'codegraph_files':";
const filesCaseIdx = src.indexOf(filesCase);
if (filesCaseIdx === -1) {
  console.error('Could not find switch case insertion point.');
  process.exit(1);
}
src = src.slice(0, filesCaseIdx) + switchCase + '\n' + src.slice(filesCaseIdx);
dirty = true;
console.log('  ✓ Switch case inserted');

// ── 5. Handler method ──
// Insert before the `async handleFiles(args)` method
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

const handleFilesSig = 'async handleFiles(args)';
const handleFilesIdx = src.indexOf(handleFilesSig);
if (handleFilesIdx === -1) {
  console.error('Could not find handleFiles method for insertion.');
  process.exit(1);
}
const lineStart = src.lastIndexOf('\n', handleFilesIdx - 1);
src = src.slice(0, lineStart + 1) + handler + '\n\n    ' + src.slice(lineStart + 1);
dirty = true;
console.log('  ✓ Handler method inserted');

// ── Write back ──
if (dirty) {
  writeFileSync(toolsPath, src, 'utf-8');
  console.log(`\n✅ Patched: ${toolsPath}`);
  console.log('   Reload Window (Ctrl+Shift+P → Developer: Reload Window) to activate.');
} else {
  console.log('\n✅ Already patched — nothing to do.');
}
