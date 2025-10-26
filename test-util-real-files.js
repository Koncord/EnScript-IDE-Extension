/**
 * Test script to parse all EnScript files in P:\scripts\1_Core
 * This validates our new parser against real production code
 */

const fs = require('fs');
const path = require('path');
const { TextDocument } = require('vscode-languageserver-textdocument');

// Import our new parser from compiled JavaScript
const { parseWithDiagnostics } = require('./out/cli');

const SCRIPTS_DIR = 'P:\\scripts';

function findFiles(dir, extension = '.cpp') {
    const files = [];
    
    if (!fs.existsSync(dir)) {
        console.error(`❌ Directory not found: ${dir}`);
        return files;
    }
    
    function walkDir(currentDir) {
        let items;
        try {
            items = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            return;
        }
        
        for (const item of items) {
            const fullPath = path.join(currentDir, item.name);
            
            if (item.isDirectory()) {
                walkDir(fullPath);
            } else if (item.isFile() && item.name.endsWith(extension)) {
                files.push(fullPath);
            }
        }
    }
    
    walkDir(dir);
    return files;
}

function parseFile(filePath, globalStartTime = null, globalTimeoutMs = 60000, forceStrict = false, suppressStyleWarnings = false, skipFunctionBodies = true) {
    try {
        // Check global timeout before starting
        if (globalStartTime && Date.now() - globalStartTime > globalTimeoutMs) {
            throw new Error('Global timeout exceeded before parsing file');
        }
        
        const content = fs.readFileSync(filePath, 'utf-8');
        const document = TextDocument.create(
            `file://${filePath.replace(/\\/g, '/')}`,
            'enscript',
            1,
            content
        );
        
        // Add timeout protection to prevent infinite loops
        const startTime = Date.now();
        
        let result;

        // Check timeout before expensive operation
        if (globalStartTime && Date.now() - globalStartTime > globalTimeoutMs) {
            throw new Error('Global timeout exceeded during parsing');
        }
        
        result = parseWithDiagnostics(document, {
            errorRecovery: true,
            lenientSemicolons: forceStrict ? false : true, // Force strict if requested
            suppressStylisticWarnings: suppressStyleWarnings, // Suppress style warnings if requested
            debug: false,  // Turn off debug output for cleaner results
            preprocessorDefinitions: new Set(),
            skipFunctionBodies: skipFunctionBodies // Skip function bodies based on parameter
        });
        
        const parseTime = Date.now() - startTime;
        if (parseTime > 1000) {
            console.log(`   ⏱️ Slow parse: ${parseTime}ms`);
        }
        
        return {
            filePath,
            success: true,
            ast: result.file,
            diagnostics: result.diagnostics,
            classes: result.file.classes?.length || 0,
            functions: result.file.functions?.length || 0,
            enums: result.file.enums?.length || 0
        };
        
    } catch (error) {
        return {
            filePath,
            success: false,
            error: error.message,
            stack: error.stack
        };
    }
}

function showUsage() {
    console.log('🚀 EnScript Parser Test Utility');
    console.log('='.repeat(50));
    console.log('Usage: node test-util-real-files.js [file-path] [options]');
    console.log('       node test-util-real-files.js [options]');
    console.log('');
    console.log('Arguments:');
    console.log('  file-path             Test a specific file instead of all files');
    console.log('');
    console.log('Options:');
    console.log('  --print-files         Show each file as it\'s being processed');
    console.log('  --strict              Use strict semicolon parsing for all files');
    console.log('  --no-style-warnings   Suppress stylistic warnings (like unnecessary semicolons)');
    console.log('  --no-function-bodies  Skip function body parsing (faster)');
    console.log('  --help                Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  node test-util-real-files.js');
    console.log('  node test-util-real-files.js "P:\\scripts\\4_World\\Plugins\\PluginBase\\PluginConfigViewer.c"');
    console.log('  node test-util-real-files.js --strict');
    console.log('  node test-util-real-files.js --strict --no-style-warnings');
    console.log('  node test-util-real-files.js --print-files --strict');
    process.exit(0);
}

function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    
    // Check for options
    const printFiles = args.includes('--print-files');
    const strictMode = args.includes('--strict');
    const noStyleWarnings = args.includes('--no-style-warnings');
    const noFunctionBodies = args.includes('--no-function-bodies');
    const showHelp = args.includes('--help') || args.includes('-h');
    
    if (showHelp) {
        showUsage();
        return;
    }
    
    // Check if first argument is a file path (doesn't start with --)
    const singleFile = args.find(arg => !arg.startsWith('--'));
    
    if (singleFile) {
        // Single file mode
        console.log('🔍 Testing single EnScript file...');
        console.log(`📄 File: ${singleFile}`);
        
        if (!fs.existsSync(singleFile)) {
            console.error(`❌ File not found: ${singleFile}`);
            console.log('\nUsage: node test-util-real-files.js <file-path> [options]');
            console.log('Example: node test-util-real-files.js "P:\\scripts\\4_World\\Plugins\\PluginBase\\PluginConfigViewer.c"');
            process.exit(1);
        }
        
        if (strictMode) {
            console.log('⚠️  STRICT MODE: File will be parsed with strict semicolon rules');
        }
        if (noStyleWarnings) {
            console.log('🔇 STYLE SUPPRESSION: Stylistic warnings will be suppressed');
        }
        if (noFunctionBodies) {
            console.log('⏩ SKIP BODIES: Function bodies will be skipped for faster parsing');
        }
        
        console.log('🚀 Starting parse...');
        const result = parseFile(singleFile, null, 60000, strictMode, noStyleWarnings, noFunctionBodies);
        
        console.log(`📏 File size: ${fs.readFileSync(singleFile, 'utf8').length} bytes`);
        
        if (result.success) {
            console.log('✅ Parse successful!');
            console.log(`📊 Classes: ${result.classes}, Functions: ${result.functions}, Enums: ${result.enums}`);
            
            if (result.diagnostics && result.diagnostics.length > 0) {
                console.log(`⚠️  Found ${result.diagnostics.length} diagnostic(s):`);
                result.diagnostics.slice(0, 10).forEach(diag => {
                    console.log(`   - ${diag.message} (line ${(diag.range?.start?.line || 0) + 1})`);
                });
                if (result.diagnostics.length > 10) {
                    console.log(`   ... and ${result.diagnostics.length - 10} more diagnostics`);
                }
            } else {
                console.log('🎉 No diagnostics found!');
            }
        } else {
            console.log('❌ Parse failed!');
            console.log(`Error: ${result.error}`);
        }
        
        console.log('\n📊 Result:', {
            success: result.success,
            diagnostics: result.diagnostics?.length || 0,
            classes: result.classes || 0,
            functions: result.functions || 0,
            enums: result.enums || 0
        });
        
        return;
    }
    
    // Batch mode (existing functionality)
    console.log('🚀 Testing EnScript Parser on ENTIRE DayZ Script Base');
    if (strictMode) {
        console.log('⚠️  STRICT MODE: All files will be parsed with strict semicolon rules');
    }
    if (printFiles) {
        console.log('📄 VERBOSE MODE: Showing each file as it\'s processed');
    }
    if (noStyleWarnings) {
        console.log('🔇 STYLE SUPPRESSION: Stylistic warnings will be suppressed');
    }
    if (noFunctionBodies) {
        console.log('⏩ SKIP BODIES: Function bodies will be skipped for faster parsing');
    }
    console.log('='.repeat(70));
    console.log(`📁 Scanning directory: ${SCRIPTS_DIR}`);
    
    const startTime = Date.now();
    const files = findFiles(SCRIPTS_DIR, '.c');
    const scanTime = Date.now() - startTime;
    
    console.log(`📊 Found ${files.length} EnScript files (scanned in ${scanTime}ms)`);
    
    if (files.length === 0) {
        console.log('❌ No files found to parse');
        return;
    }
    
    console.log('\n🔍 Parsing files...\n');
    
    const results = [];
    let successCount = 0;
    let errorCount = 0;
    let totalClasses = 0;
    let totalFunctions = 0;
    let totalEnums = 0;
    let totalDiagnostics = 0;
    
    const parseStartTime = Date.now();
    const globalTimeoutMs = 300000; // 5 minutes total timeout for all files
    
    // Parse ALL files (removed 500 file limit)
    const maxFiles = files.length;
    console.log(`📋 Testing ALL ${maxFiles} files`);
    
    for (let i = 0; i < maxFiles; i++) {
        // Check for global timeout in the loop
        const elapsed = Date.now() - parseStartTime;
        if (elapsed > globalTimeoutMs) {
            console.log(`\n❌ GLOBAL TIMEOUT: Process exceeded ${globalTimeoutMs/1000}s limit after ${Math.round(elapsed/1000)}s`);
            console.log(`📊 Processed ${i}/${maxFiles} files before timeout`);
            break;
        }
        const file = files[i];
        
        // Print current file being processed if --print-files flag is set
        if (printFiles) {
            const relativePath = path.relative(SCRIPTS_DIR, file);
            console.log(`📄 Processing [${i+1}/${maxFiles}]: ${relativePath}`);
        }
        
        const result = parseFile(file, parseStartTime, globalTimeoutMs, strictMode, noStyleWarnings, noFunctionBodies);
        results.push(result);
        
        if (result.success) {
            successCount++;
            totalClasses += result.classes || 0;
            totalFunctions += result.functions || 0;
            totalEnums += result.enums || 0;
            totalDiagnostics += result.diagnostics?.length || 0;
            
            // Only show files that have diagnostics (errors/warnings)
            if (result.diagnostics?.length > 0) {
                const relativePath = path.relative(SCRIPTS_DIR, result.filePath);
                console.log(`✅ [${i + 1}/${files.length}] ${relativePath}`);
                console.log(`   ⚠️  ${result.diagnostics.length} diagnostic(s)`);
                
                if (result.diagnostics.length <= 3) {
                    result.diagnostics.forEach(diag => {
                        console.log(`      - ${diag.message} (${path.relative(SCRIPTS_DIR, result.filePath)}:${diag.range.start.line + 1}:${diag.range.start.character + 1}) (line ${diag.range.start.line + 1})`);
                    });
                } else {
                    result.diagnostics.slice(0, 2).forEach(diag => {
                        console.log(`      - ${diag.message} (${path.relative(SCRIPTS_DIR, result.filePath)}:${diag.range.start.line + 1}:${diag.range.start.character + 1}) (line ${diag.range.start.line + 1})`);
                    });
                    console.log(`      - ... and ${result.diagnostics.length - 2} more`);
                }
            }
        } else {
            errorCount++;
            const relativePath = path.relative(SCRIPTS_DIR, result.filePath);
            console.log(`❌ [${i + 1}/${maxFiles}] ${relativePath}`);
            console.log(`   Error: ${result.error}`);
        }
        
        // Show progress every 50 files and detect stalling
        if (i % 50 === 0 && i > 0) {
            const elapsed = Date.now() - parseStartTime;
            const avgTime = elapsed / (i + 1);
            const estimatedTotal = avgTime * maxFiles;
            const remaining = estimatedTotal - elapsed;
            const successRate = Math.round((successCount / (i + 1)) * 100);
            console.log(`🔄 Progress: ${i + 1}/${maxFiles} (${Math.round((i + 1) / maxFiles * 100)}%) - Success: ${successRate}% - ETA: ${Math.round(remaining / 1000)}s`);
            
            // Detect if parsing is taking too long per file on average
            if (avgTime > 2000) {
                console.log('⚠️ Parsing is taking longer than expected, consider stopping...');
            }
        }
    }
    
    const parseEndTime = Date.now();
    const totalParseTime = parseEndTime - parseStartTime;
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📋 COMPLETE DAYZ SCRIPT PARSING SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Successful: ${successCount}/${results.length} files`);
    console.log(`❌ Failed: ${errorCount}/${results.length} files`);
    console.log(`📈 Success Rate: ${Math.round((successCount / results.length) * 100)}%`);
    console.log(`⏱️  Total Parse Time: ${(totalParseTime / 1000).toFixed(2)}s`);
    console.log(`🚄 Average Per File: ${(totalParseTime / results.length).toFixed(2)}ms`);
    console.log(`📊 Total Classes: ${totalClasses}`);
    console.log(`🔧 Total Functions: ${totalFunctions}`);
    console.log(`📋 Total Enums: ${totalEnums}`);
    console.log(`⚠️  Total Diagnostics: ${totalDiagnostics}`);
    
    // Show error details
    if (errorCount > 0) {
        console.log('\n🔍 ERROR DETAILS:');
        results.filter(r => !r.success).slice(0, 5).forEach(result => {
            const relativePath = path.relative(SCRIPTS_DIR, result.filePath);
            console.log(`\n❌ ${relativePath}:`);
            console.log(`   ${result.error}`);
        });
        if (results.filter(r => !r.success).length > 5) {
            console.log(`\n... and ${results.filter(r => !r.success).length - 5} more errors`);
        }
    }
}

if (require.main === module) {
    main();
}

