const { parseProject } = require('./out/cli');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = 'P://.';

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


// Convert Maps to plain objects for JSON serialization
function mapToObject(map) {
    if (!map || typeof map[Symbol.iterator] !== 'function') {
        return map;
    }
    const obj = {};
    for (const [key, value] of map) {
        // Recursively convert nested Maps
        if (value instanceof Map) {
            obj[key] = mapToObject(value);
        } else if (typeof value === 'object' && value !== null) {
            // Handle objects that might contain Maps
            obj[key] = convertValue(value);
        } else {
            obj[key] = value;
        }
    }
    return obj;
}

function convertValue(value) {
    if (value instanceof Map) {
        return mapToObject(value);
    } else if (Array.isArray(value)) {
        return value.map(convertValue);
    } else if (typeof value === 'object' && value !== null) {
        const obj = {};
        for (const [k, v] of Object.entries(value)) {
            obj[k] = convertValue(v);
        }
        return obj;
    }
    return value;
}

function convertProjectFileForDisplay(cfg) {
    return {
        cfgPatches: mapToObject(cfg.cfgPatches),
        cfgMods: mapToObject(cfg.cfgMods.mods)
    };
}

function main() {
    const configFiles = findFiles(SCRIPTS_DIR);
    console.log(`Found ${configFiles.length} config files.`);
    for (const filePath of configFiles) {
        try {
            const cfg = parseProject(filePath);
            if (!cfg) continue;
            console.log(`✅ Parsed ${filePath} successfully.`);
            const displayCfg = convertProjectFileForDisplay(cfg);
            console.log(`📊 Result:`, JSON.stringify(displayCfg, null, 2));
        } catch (error) {
            console.error(`❌ ${error.message}`);
        }
    }
    console.log('All done.');
}

if (require.main === module) {
    main();
}