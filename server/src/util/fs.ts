import * as fs from 'node:fs/promises';
import * as path from 'path';

export async function readFileUtf8(p: string): Promise<string> {
    return fs.readFile(p, 'utf8');
}

export async function findAllFiles(dir: string, extensions: string[], files: string[] = []): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await findAllFiles(fullPath, extensions, files);
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            files.push(fullPath);
        }
    }

    return files;
}
