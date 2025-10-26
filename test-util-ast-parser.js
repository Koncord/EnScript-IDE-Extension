/**
 * Test utility to demonstrate AST Printer functionality
 * This script shows how to use the new AST printer for debugging and visualization
 */

const { TextDocument } = require('vscode-languageserver-textdocument');
const { ASTPrinter, parseWithDiagnostics } = require('./out/cli');



function parseFileFromPath(filePath, options = {}) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 PARSING FILE: ${filePath}`);
    console.log(`${'='.repeat(60)}`);
    
    try {
        // Check if file exists
        const fs = require('fs');
        const path = require('path');
        
        if (!fs.existsSync(filePath)) {
            console.error(`❌ File not found: ${filePath}`);
            return;
        }
        
        // Read file content
        const content = fs.readFileSync(filePath, 'utf-8');
        const fileName = path.basename(filePath);
        
        console.log(`📄 File: ${fileName}`);
        console.log(`📏 Size: ${content.length} bytes`);
        console.log(`📍 Path: ${path.resolve(filePath)}`);
        
        // Create document and parse
        const document = TextDocument.create(
            `file://${filePath.replace(/\\/g, '/')}`,
            'enscript',
            1,
            content
        );
        
        console.log('\n🚀 Starting AST parsing...');
        const startTime = Date.now();
        
        // Configure parser options based on command line flags
        const parserConfig = {
            errorRecovery: true,
            lenientSemicolons: options.strict ? false : true, // Use strict parsing if --strict flag is set
            suppressStylisticWarnings: options.noStyleWarnings || false,
            debug: false,
            preprocessorDefinitions: new Set(),
            skipFunctionBodies: false
        };
        
        if (options.strict) {
            console.log('⚠️  STRICT MODE: Using strict semicolon parsing');
        }
        
        let ast;
        let parseErrors = [];
        let originalStrictErrors = [];
        
        try {
            // First parsing attempt with current configuration
            const { file, diagnostics } = parseWithDiagnostics(document, parserConfig);
            ast = file;
            parseErrors = diagnostics;
            
            // In strict mode, if there are parse errors, try to recover with lenient parsing
            if (options.strict && parseErrors.length > 0) {
                console.log(`⚠️  Strict parsing found ${parseErrors.length} errors. Attempting AST recovery...`);
                
                // Store original strict mode errors for later display
                originalStrictErrors = [...parseErrors];
                
                // Optionally show strict mode errors before recovery
                if (options.showStrictErrors) {
                    console.log('\n📋 Strict Mode Diagnostics (before recovery):');
                    console.log('-'.repeat(45));
                    parseErrors.slice(0, 5).forEach((diag, i) => {
                        const severity = diag.severity === 1 ? '❌ ERROR' : '⚠️  WARNING';
                        const line = diag.range.start.line + 1;
                        const character = diag.range.start.character + 1;
                        console.log(`  ${i + 1}. ${severity} - ${diag.message}`);
                        console.log(`     Location: ${fileName}:${line}:${character} (line ${line})`);
                    });
                    if (parseErrors.length > 5) {
                        console.log(`     ... and ${parseErrors.length - 5} more errors`);
                    }
                    console.log('');
                }
                
                // Create lenient config for recovery
                const recoveryConfig = {
                    ...parserConfig,
                    lenientSemicolons: true,
                    errorRecovery: true
                };
                
                const { file: recoveredFile, diagnostics: recoveryDiagnostics } = parseWithDiagnostics(document, recoveryConfig);
                
                if (recoveryDiagnostics.length < parseErrors.length) {
                    console.log(`✅ AST recovery successful! Reduced errors from ${parseErrors.length} to ${recoveryDiagnostics.length}`);
                    console.log('   Using lenient semicolon parsing to preserve AST structure');
                    ast = recoveredFile;
                    parseErrors = recoveryDiagnostics;
                } else {
                    console.log(`❌ AST recovery did not improve parsing (still ${recoveryDiagnostics.length} errors)`);
                }
            }
        } catch (error) {
            // If strict mode parsing fails entirely, try lenient recovery
            if (options.strict) {
                console.log('❌ Strict parsing failed completely. Attempting lenient recovery...');
                
                try {
                    const recoveryConfig = {
                        ...parserConfig,
                        lenientSemicolons: true,
                        errorRecovery: true
                    };
                    
                    const { file: recoveredFile, diagnostics: recoveryDiagnostics } = parseWithDiagnostics(document, recoveryConfig);
                    console.log(`✅ Recovery parsing succeeded with ${recoveryDiagnostics.length} errors`);
                    console.log('   Fallback to lenient parsing preserved AST structure');
                    ast = recoveredFile;
                    parseErrors = recoveryDiagnostics;
                } catch {
                    console.log('❌ Recovery parsing also failed. Using fallback.');
                    throw error; // Re-throw original error
                }
            } else {
                throw error; // Re-throw if not in strict mode
            }
        }
        
        const parseTime = Date.now() - startTime;
        console.log(`⚡ Parse completed in ${parseTime}ms`);
        
        console.log('\n🌳 AST Structure:');
        console.log('-'.repeat(40));
        
        // Enable colors by default, allow explicit disable with --no-colors
        const printerOptions = {
            useColors: options.useColors !== undefined ? options.useColors : true,
            includePositions: true,
            includeURI: false,
            compact: options.compact || false,
            ...options
        };
        
        // Only set maxDepth if explicitly provided
        if (options.maxDepth !== undefined) {
            printerOptions.maxDepth = options.maxDepth;
        }
        
        const printer = new ASTPrinter(printerOptions);
        
        const output = printer.print(ast);
        console.log(output);
        
        console.log('\n📊 AST Statistics:');
        console.log('-'.repeat(20));
        const stats = printer.printStats(ast);
        console.log(stats);
        
        // Show body summary
        if (ast.body && ast.body.length > 0) {
            console.log('\n📋 Top-level declarations:');
            console.log('-'.repeat(25));
            ast.body.forEach((decl, i) => {
                const name = decl.name || '<anonymous>';
                console.log(`  ${i + 1}. ${decl.kind}: ${name}`);
            });
        }
        
        // Show parse errors if any (formatted like test-util-real-files)
        // In strict mode with recovery, show original errors even if recovery succeeded
        const errorsToShow = options.strict && originalStrictErrors.length > 0 ? originalStrictErrors : parseErrors;
        const diagnosticsTitle = options.strict && originalStrictErrors.length > 0 && parseErrors.length === 0 
            ? `Strict Mode Issues (recovered AST available)`
            : `Found ${errorsToShow.length} diagnostic(s)`;
        
        if (errorsToShow.length > 0) {
            console.log(`\n⚠️  ${diagnosticsTitle}:`);
            console.log('-'.repeat(Math.max(30, diagnosticsTitle.length + 5)));
            errorsToShow.forEach((diag, i) => {
                const severity = diag.severity === 1 ? '❌ ERROR' : '⚠️  WARNING';
                const line = diag.range.start.line + 1;
                const character = diag.range.start.character + 1;
                console.log(`  ${i + 1}. ${severity} - ${diag.message}`);
                console.log(`     Location: ${fileName}:${line}:${character} (line ${line})`);
            });
            
            // Add note if recovery was used
            if (options.strict && originalStrictErrors.length > 0 && parseErrors.length === 0) {
                console.log(`\n💡 Note: AST was successfully recovered using lenient parsing, but the above issues should still be fixed.`);
            }
        } else {
            console.log('\n🎉 No diagnostics found!');
        }
        
        console.log('\n✅ File parsing completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Error during file parsing:');
        console.error(`Message: ${error.message}`);
        if (error.stack) {
            console.error('Stack trace:');
            console.error(error.stack.split('\n').slice(0, 10).join('\n'));
        }
    }
}

// Command line argument handling
if (process.argv.length > 2) {
    const args = process.argv.slice(2);
    
    // Check for help first
    if (args.includes('--help') || args.includes('-h')) {
        console.log('🔍 EnScript AST Printer');
        console.log('=======================');
        console.log('This utility parses EnScript files and displays their AST structure.');
        console.log('\nUsage:');
        console.log('  node test-util-ast-printer.js [file-path] [options]');
        console.log('\nOptions:');
        console.log('  --compact           Show compact output with limited nesting');
        console.log('  --max-depth=N       Limit AST traversal to N levels deep');
        console.log('  --no-positions      Hide position information');
        console.log('  --no-colors         Disable colors (colors enabled by default)');
        console.log('  --strict            Use strict semicolon parsing with AST recovery fallback');
        console.log('  --show-strict-errors Show original strict mode errors before recovery');
        console.log('  --no-style-warnings Suppress stylistic warnings (like unnecessary semicolons)');
        console.log('  --help, -h          Show this help message');
        console.log('\nExamples:');
        console.log('  node test-util-ast-printer.js myfile.c');
        console.log('  node test-util-ast-printer.js P:\\scripts\\3_Game\\something.c --compact');
        console.log('  node test-util-ast-printer.js ./test.enscript --max-depth=5 --no-positions');
        console.log('  node test-util-ast-printer.js ./test.c --strict');
        console.log('  node test-util-ast-printer.js ./test.c --strict --show-strict-errors');
        return;
    }
    
    const filePath = args.find(arg => !arg.startsWith('--'));
    if (!filePath) {
        console.error('❌ No file path provided');
        console.log('Use --help for usage information');
        return;
    }
    
    const options = {};
    
    // Parse additional options
    for (const arg of args) {
        if (arg === '--compact') {
            options.compact = true;
        } else if (arg.startsWith('--max-depth=')) {
            options.maxDepth = parseInt(arg.split('=')[1]);
        } else if (arg === '--no-positions') {
            options.includePositions = false;
        } else if (arg === '--no-colors') {
            options.useColors = false;
        } else if (arg === '--strict') {
            options.strict = true;
        } else if (arg === '--show-strict-errors') {
            options.showStrictErrors = true;
        } else if (arg === '--no-style-warnings') {
            options.noStyleWarnings = true;
        }
    }
    
    parseFileFromPath(filePath, options);
} else {
    console.log('🔍 EnScript AST Printer');
    console.log('=======================');
    console.log('This utility parses EnScript files and displays their AST structure.');
    console.log('\nUsage:');
    console.log('  node test-util-ast-printer.js [file-path] [options]');
    console.log('\nOptions:');
    console.log('  --compact           Show compact output with limited nesting');
    console.log('  --max-depth=N       Limit AST traversal to N levels deep');
    console.log('  --no-positions      Hide position information');
    console.log('  --no-colors         Disable colors (colors enabled by default)');
    console.log('  --strict            Use strict semicolon parsing with AST recovery fallback');
    console.log('  --show-strict-errors Show original strict mode errors before recovery');
    console.log('  --no-style-warnings Suppress stylistic warnings (like unnecessary semicolons)');
    console.log('\nExamples:');
    console.log('  node test-util-ast-printer.js myfile.c');
    console.log('  node test-util-ast-printer.js P:\\scripts\\3_Game\\something.c --compact');
    console.log('  node test-util-ast-printer.js ./test.enscript --max-depth=5 --no-positions');
    console.log('  node test-util-ast-printer.js ./test.c --strict');
    console.log('  node test-util-ast-printer.js ./test.c --strict --show-strict-errors');
}
