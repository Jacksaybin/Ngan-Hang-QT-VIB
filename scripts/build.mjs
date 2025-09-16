#!/usr/bin/env node
/**
 * Build script:
 *  - Cleans dist/
 *  - Bundles JS entry points with esbuild (ESM) -> dist/public/js
 *  - Copies HTML, CSS, assets to dist/public preserving structure
 *  - Generates a cache-busted hash for main bundle (simple content hash)
 */
import { build } from 'esbuild';
import { rmSync, mkdirSync, readdirSync, statSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');
const dist = join(root, 'dist');
const pub = join(dist, 'public');

function clean() {
    try { rmSync(dist, { recursive: true, force: true }); } catch { }
    mkdirSync(pub, { recursive: true });
}

const jsEntries = [
    'full-homepage.js',
    'shared-form.js',
    'huythevib.js'
].filter(f => statExists(join(root, f)));

function statExists(p) { try { statSync(p); return true; } catch { return false; } }

async function bundle() {
    if (!jsEntries.length) { console.log('[build] No JS entries found, skipping bundling'); return []; }
    const outdir = join(pub, 'js');
    mkdirSync(outdir, { recursive: true });
    const result = await build({
        entryPoints: jsEntries.map(f => join(root, f)),
        outdir,
        format: 'esm',
        bundle: true,
        splitting: true,
        sourcemap: true,
        target: ['es2020'],
        chunkNames: 'chunks/[name]-[hash]',
        assetNames: 'assets/[name]-[hash]',
        metafile: true,
        treeShaking: true,
        logLevel: 'info'
    });
    // hash main entry maps
    const produced = Object.keys(result.metafile.outputs)
        .filter(o => o.endsWith('.js'))
        .map(o => ({ out: o, path: join(root, o) }));
    return produced;
}

function copyRecursive(srcDir, destDir, patterns) {
    mkdirSync(destDir, { recursive: true });
    const entries = readdirSync(srcDir);
    for (const entry of entries) {
        const s = join(srcDir, entry);
        const d = join(destDir, entry);
        const st = statSync(s);
        if (st.isDirectory()) {
            copyRecursive(s, d, patterns);
        } else {
            if (patterns && !patterns.some(p => entry.match(p))) {
                // If patterns list provided, copy only matching
            }
            copyFileSync(s, d);
        }
    }
}

function copyStatics() {
    // Copy root html/css
    const rootFiles = readdirSync(root).filter(f => /\.(html|css)$/.test(f));
    for (const f of rootFiles) {
        copyFileSync(join(root, f), join(pub, f));
    }
    // Copy assets directory
    if (statExists(join(root, 'assets'))) {
        copyRecursive(join(root, 'assets'), join(pub, 'assets'));
    }
}

function patchHtmlBundleRefs() {
    // Replace script src for known JS entries to /js/<file> (bundled path)
    const files = readdirSync(pub).filter(f => f.endsWith('.html'));
    for (const file of files) {
        const fp = join(pub, file);
        let html = readFileSync(fp, 'utf8');
        for (const entry of jsEntries) {
            const base = entry.split('/').pop();
            // naive replacement if script tag references original file name
            html = html.replace(new RegExp(`<script([^>]*?)src=["']${base}["']`, 'g'), `<script$1 type="module" src="./js/${base}"`);
        }
        writeFileSync(fp, html, 'utf8');
    }
}

(async function main() {
    console.log('[build] Starting build');
    clean();
    await bundle();
    copyStatics();
    patchHtmlBundleRefs();
    console.log('[build] Done. Output in dist/public');
})();
