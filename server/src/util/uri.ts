import { URI } from 'vscode-uri';

export function normalizeUri(uri: string): string {
    return URI.parse(uri).toString();
}

/**
 * Convert a file system path to a normalized URI
 * @param path The file system path (e.g., "p:\scripts" or "/home/user/project")
 * @returns A normalized URI (e.g., "file:///p:/scripts")
 */
export function pathToUri(path: string): string {
    // URI.file() properly handles file system paths and converts them to file:// URIs
    return URI.file(path).toString();
}

/**
 * Convert a URI to a readable file path for display
 * @param uri The URI to convert (e.g., "file:///j:/Source/project/file.c")
 * @returns A normalized path (e.g., "j:/Source/project/file.c" on Windows)
 */
export function uriToDisplayPath(uri: string): string {
    try {
        const parsed = URI.parse(uri);
        // Use fsPath to get the file system path (handles Windows/Unix correctly)
        return parsed.fsPath;
    } catch {
        // If parsing fails, return the original URI
        return uri;
    }
}
