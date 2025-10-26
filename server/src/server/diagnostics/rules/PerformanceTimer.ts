import { Logger } from '../../../util';

/**
 * Performance timing utility for debugging slow functions
 */
export class PerformanceTimer {
    private static timings = new Map<string, number[]>();

    static async time<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
        const start = performance.now();
        try {
            return await fn();
        } finally {
            const duration = performance.now() - start;
            if (!this.timings.has(label)) {
                this.timings.set(label, []);
            }
            this.timings.get(label)!.push(duration);
        }
    }

    static getStats(label: string): { count: number; total: number; avg: number; max: number; } | null {
        const times = this.timings.get(label);
        if (!times || times.length === 0) return null;

        const total = times.reduce((sum, time) => sum + time, 0);
        const avg = total / times.length;
        const max = Math.max(...times);

        return { count: times.length, total, avg, max };
    }

    static getAllStats(): Record<string, { count: number; total: number; avg: number; max: number; }> {
        const result: Record<string, { count: number; total: number; avg: number; max: number; }> = {};
        for (const [label, times] of this.timings) {
            if (times.length > 0) {
                const total = times.reduce((sum, time) => sum + time, 0);
                const avg = total / times.length;
                const max = Math.max(...times);
                result[label] = { count: times.length, total, avg, max };
            }
        }
        return result;
    }

    static logStats(): void {
        const stats = this.getAllStats();
        if (Object.keys(stats).length > 0) {
            Logger.debug('🔍 UndeclaredFunction Performance Stats:');
            for (const [label, stat] of Object.entries(stats)) {
                Logger.debug(`  ${label}: ${stat.avg.toFixed(2)}ms avg (${stat.count} calls, ${stat.total.toFixed(2)}ms total, max: ${stat.max.toFixed(2)}ms)`);
            }
        }
    }

    static reset(): void {
        this.timings.clear();
    }
}
