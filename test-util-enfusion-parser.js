/**
 * Test utility for parsing Enfusion config files (.imageset, .layout)
 * Usage: node test-util-enfusion-parser.js <file-path> [options]
 * Options:
 *   --print-ast    Print the full AST
 *   --extract      Extract and print structured data (for ImageSet files)
 *   --help         Show this help message
 */

const fs = require('fs');

// Import parser from compiled output
const { parseEnfusionConfig } = require('./out/cli');
const { parseImageSet, printEnfusionAST } = require('./out/cli');

function showUsage() {
    console.log('Usage: node test-util-enfusion-parser.js <file-path> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --print-ast    Print the full AST');
    console.log('  --extract      Extract and print structured data (for ImageSet files)');
    console.log('  --help         Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  node test-util-enfusion-parser.js "P:\\gui\\imagesets\\ccgui_enforce.imageset"');
    console.log('  node test-util-enfusion-parser.js "P:\\gui\\imagesets\\ccgui_enforce.imageset" --print-ast');
    console.log('  node test-util-enfusion-parser.js "P:\\gui\\imagesets\\ccgui_enforce.imageset" --extract');
}

function parseFile(filePath, options = {}) {
    console.log(`📄 Parsing: ${filePath}`);
    console.log('');

    if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        return;
    }

    const startTime = Date.now();

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const doc = parseEnfusionConfig(content, filePath);
        const parseTime = Date.now() - startTime;

        console.log(`✅ Parse successful! (${parseTime}ms)`);
        console.log(`📏 File size: ${content.length} bytes`);
        console.log(`🌳 Nodes: ${doc.children.length}`);
        console.log('');

        if (options.printAst) {
            console.log('=== AST ===');
            console.log(printEnfusionAST(doc));
            console.log('');
        }

        if (options.extract) {
            console.log('=== Extracted Data ===');
            const imageSet = parseImageSet(filePath);
            if (imageSet) {
                console.log(JSON.stringify(imageSet, null, 2));
            } else {
                console.log('(Not an ImageSet file or parsing failed)');
            }
            console.log('');
        }

        // Print summary
        console.log('=== Summary ===');
        const classes = doc.children.filter(n => n.kind === 'class');
        const blocks = doc.children.filter(n => n.kind === 'block');
        const properties = doc.children.filter(n => n.kind === 'property');

        console.log(`Classes: ${classes.length}`);
        console.log(`Blocks: ${blocks.length}`);
        console.log(`Properties: ${properties.length}`);

        if (classes.length > 0) {
            console.log('\nTop-level classes:');
            classes.forEach(cls => {
                const name = cls.instanceName ? `${cls.className} ${cls.instanceName}` : cls.className;
                console.log(`  - ${name}`);
            });
        }

    } catch (error) {
        const parseTime = Date.now() - startTime;
        console.error(`❌ Parse failed! (${parseTime}ms)`);
        console.error('');
        console.error('Error:', error.message);
        if (error.stack) {
            console.error('');
            console.error('Stack trace:');
            console.error(error.stack);
        }
    }
}

function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help')) {
        showUsage();
        return;
    }

    const filePath = args.find(arg => !arg.startsWith('--'));
    if (!filePath) {
        console.error('❌ No file path provided');
        console.log('Use --help for usage information');
        return;
    }

    const options = {
        printAst: args.includes('--print-ast'),
        extract: args.includes('--extract')
    };

    parseFile(filePath, options);
}

if (require.main === module) {
    main();
}

module.exports = { parseFile };
