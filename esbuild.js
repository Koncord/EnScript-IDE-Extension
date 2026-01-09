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

    // Build the debug adapter
    const debugAdapterCtx = await context({
        entryPoints: ['server/src/debug-adapter-entry.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production ? 'inline' : false,
        sourcesContent: !production,
        platform: 'node',
        outfile: 'out/debug-adapter.js',
        external: [],
        logLevel: 'silent',
        plugins: [esbuildProblemMatcherPlugin],
    });

    // Build webview scripts
    const webviewScripts = [
        { in: 'media/documentation/script.ts', out: 'out/media/documentation/script.js' },
        { in: 'media/image-preview/script.ts', out: 'out/media/image-preview/script.js' },
        { in: 'media/imageset-preview/script.ts', out: 'out/media/imageset-preview/script.js' },
        { in: 'media/repl/script.ts', out: 'out/media/repl/script.js' },
    ];

    const webviewContexts = await Promise.all(
        webviewScripts.map(script => context({
            entryPoints: [script.in],
            bundle: true,
            format: 'iife',
            minify: production,
            sourcemap: !production ? 'inline' : false,
            sourcesContent: !production,
            platform: 'browser',
            outfile: script.out,
            logLevel: 'silent',
            plugins: [esbuildProblemMatcherPlugin],
        }))
    );

    if (watch) {
        await Promise.all([
            clientCtx.watch(),
            serverCtx.watch(),
            cliCtx.watch(),
            debugAdapterCtx.watch(),
            ...webviewContexts.map(ctx => ctx.watch())
        ]);
    } else {
        await Promise.all([
            clientCtx.rebuild(),
            serverCtx.rebuild(),
            cliCtx.rebuild(),
            debugAdapterCtx.rebuild(),
            ...webviewContexts.map(ctx => ctx.rebuild())
        ]);
        await clientCtx.dispose();
        await serverCtx.dispose();
        await cliCtx.dispose();
        await debugAdapterCtx.dispose();
        await Promise.all(webviewContexts.map(ctx => ctx.dispose()));
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
