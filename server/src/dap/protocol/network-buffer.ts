import { Socket } from 'net';
import { EventEmitter } from 'events';
import { Logger } from '../../util/logger';

export class NetworkBuffer {
    private buffer: Buffer = Buffer.alloc(0);
    private closed = false;
    private readonly events = new EventEmitter();
    private readLocked = false;
    private abortController?: AbortController;

    constructor(
        private readonly stream: Socket,
        private readonly closeStream: boolean = false
    ) { }

    async start(signal?: AbortSignal): Promise<void> {
        this.abortController = new AbortController();

        // Link external signal if provided
        if (signal) {
            signal.addEventListener('abort', () => this.abortController?.abort());
        }

        try {
            while (!this.closed && !this.abortController.signal.aborted) {
                const dataBuffer = await new Promise<Buffer | null>((resolve, reject) => {
                    let resolved = false;

                    const onData = (data: Buffer) => {
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            // Create a copy immediately to avoid any buffer reuse issues
                            const copy = Buffer.from(data);
                            resolve(copy);
                        }
                    };

                    const onEnd = () => {
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            resolve(null);
                        }
                    };

                    const onError = (err: Error) => {
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            reject(err);
                        }
                    };

                    const onCancel = () => {
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            reject(new Error('Operation cancelled'));
                        }
                    };

                    const cleanup = () => {
                        this.stream.off('data', onData);
                        this.stream.off('end', onEnd);
                        this.stream.off('error', onError);
                    };

                    this.stream.once('data', onData);
                    this.stream.once('end', onEnd);
                    this.stream.once('error', onError);
                    this.abortController!.signal.addEventListener('abort', onCancel);
                });

                if (dataBuffer === null) {
                    Logger.info('Connection closed by peer');
                    break;
                }

                this.store(dataBuffer, dataBuffer.length);
            }
        } catch (err: unknown) {
            const error = err as { message?: string; code?: string; constructor?: { name: string } };
            if (error.message === 'Operation cancelled') {
                Logger.info('Socket read cancelled');
            } else if (error.code === 'ECONNRESET' || error.code === 'EPIPE' || error.code === 'ETIMEDOUT') {
                Logger.info(`Socket error during read: ${error.code} - ${error.message}`);
            } else if (error.message?.includes('disposed') || error.message?.includes('destroyed')) {
                Logger.info(`Socket disposed during read: ${error.message}`);
            } else {
                Logger.error(`Unexpected socket read error (Type: ${error.constructor?.name}): ${error.message}`);
            }
        } finally {
            this.close();
        }
    }

    private store(data: Buffer, length: number): void {
        // Data is already a copy from Buffer.from() in start(), safe to append directly
        const newData = length === data.length ? data : Buffer.from(data.subarray(0, length));
        this.buffer = Buffer.concat([this.buffer, newData]);

        // Signal that data is available
        this.events.emit('data');
    }

    /**
     * Returns the number of bytes currently available in the buffer
     */
    available(): number {
        return this.buffer.length;
    }

    /**
     * Peek at the next n bytes without consuming them
     */
    async peek(n: number): Promise<Buffer> {
        // Return up to n bytes without removing them from buffer
        const length = Math.min(n, this.buffer.length);
        return this.buffer.slice(0, length);
    }

    async read(n: number, timeout?: number): Promise<Buffer> {
        const timeoutMs = timeout !== undefined ? timeout : 10000;

        // Simple lock - wait if another read is in progress
        while (this.readLocked) {
            await new Promise(resolve => setImmediate(resolve));
        }
        this.readLocked = true;

        try {
            while (this.buffer.length < n) {
                if (this.closed) {
                    throw new Error(`Socket closed. Needed ${n} bytes, got ${this.buffer.length}.`);
                }

                const timeoutValue = timeoutMs === 0 ? Infinity : timeoutMs;
                const acquired = await new Promise<boolean>((resolve) => {
                    const timer = timeoutValue !== Infinity
                        ? setTimeout(() => {
                            this.events.off('data', onData);
                            resolve(false);
                        }, timeoutValue)
                        : null;

                    const onData = () => {
                        if (timer) clearTimeout(timer);
                        this.events.off('data', onData);
                        resolve(true);
                    };

                    this.events.once('data', onData);
                });

                if (!acquired) {
                    throw new Error(`Timed out waiting for ${n} bytes, only got ${this.buffer.length}`);
                }
            }

            // Extract the requested bytes (use slice to create a copy, not a view)
            const data = this.buffer.slice(0, n);
            this.buffer = this.buffer.slice(n);

            // Verify we're returning the right amount
            if (data.length !== n) {
                throw new Error(`NetworkBuffer.read: Requested ${n} bytes but returning ${data.length} bytes. Buffer had ${this.buffer.length + data.length} bytes.`);
            }

            return data;
        } finally {
            this.readLocked = false;
        }
    }

    async write(data: Buffer, signal?: AbortSignal): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            let resolved = false;

            const onCancel = () => {
                if (!resolved) {
                    resolved = true;
                    reject(new Error('Operation cancelled'));
                }
            };

            if (signal) {
                signal.addEventListener('abort', onCancel);
            }

            this.stream.write(data, (err) => {
                if (!resolved) {
                    resolved = true;
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            });
        });
    }

    close(): void {
        if (this.closed) return;

        this.closed = true;
        this.events.emit('data'); // Wake up any waiting reads
        this.abortController?.abort();
    }

    dispose(): void {
        this.close();
        this.events.removeAllListeners();
        this.abortController = undefined;
        if (this.closeStream) {
            this.stream.destroy();
        }
    }
}
