const { context } = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd(result => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

async function main() {
    // Build the extension (client)
    const clientCtx = await context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production ? 'inline' : false,
        sourcesContent: !production,
        platform: 'node',
        outfile: 'out/extension.js',
        external: ['vscode'],
        logLevel: 'silent',
        plugins: [esbuildProblemMatcherPlugin],
    });

    // Build the language server
    const serverCtx = await context({
        entryPoints: ['server/src/index.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production ? 'inline' : false,
        sourcesContent: !production,
        platform: 'node',
        outfile: 'out/index.js',
        external: ['vscode'],
        logLevel: 'silent',
        plugins: [esbuildProblemMatcherPlugin],
    });

    const cliCtx = await context({
        entryPoints: ['server/src/cli-entry.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production ? 'inline' : false,
        sourcesContent: !production,
        platform: 'node',
        outfile: 'out/cli.js',
        external: [],
        logLevel: 'silent',
        plugins: [esbuildProblemMatcherPlugin],
    });

    if (watch) {
        await Promise.all([clientCtx.watch(), serverCtx.watch(), cliCtx.watch()]);
    } else {
        await Promise.all([clientCtx.rebuild(), serverCtx.rebuild(), cliCtx.rebuild()]);
        await clientCtx.dispose();
        await serverCtx.dispose();
        await cliCtx.dispose();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
