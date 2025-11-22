import { Socket } from 'net';
import { EventEmitter } from 'events';
import { Logger } from '../../util/logger';

export class NetworkBuffer {
    private buffer: Buffer;
    private readPosition = 0;
    private writePosition = 0;
    private availableBytes = 0;
    private closed = false;
    private readonly events = new EventEmitter();
    private readLocked = false;
    private writeLocked = false;
    private abortController?: AbortController;

    constructor(
        private readonly stream: Socket,
        private readonly closeStream: boolean = false
    ) {
        this.buffer = Buffer.alloc(65536); // 64KB initial buffer
    }

    async start(signal?: AbortSignal): Promise<void> {
        this.abortController = new AbortController();
        
        // Link external signal if provided
        if (signal) {
            signal.addEventListener('abort', () => this.abortController?.abort());
        }

        try {
            const tempBuffer = Buffer.alloc(16384); // 16KB read buffer for better throughput
            
            while (!this.closed && !this.abortController.signal.aborted) {
                const bytesRead = await new Promise<number>((resolve, reject) => {
                    let resolved = false;
                    
                    const onData = (data: Buffer) => {
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            const length = Math.min(data.length, tempBuffer.length);
                            data.copy(tempBuffer, 0, 0, length);
                            resolve(length);
                        }
                    };

                    const onEnd = () => {
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            resolve(0);
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

                if (bytesRead === 0) {
                    Logger.info('Connection closed by peer');
                    break;
                }

                this.store(tempBuffer, bytesRead);
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
        // Ensure we have enough space
        const requiredCapacity = this.availableBytes + length;
        if (requiredCapacity > this.buffer.length) {
            // Need to grow the buffer
            const newCapacity = Math.max(this.buffer.length * 2, requiredCapacity);
            const newBuffer = Buffer.alloc(newCapacity);
            
            // Copy existing data to new buffer
            if (this.availableBytes > 0) {
                if (this.readPosition < this.writePosition) {
                    // Data is contiguous
                    this.buffer.copy(newBuffer, 0, this.readPosition, this.writePosition);
                } else {
                    // Data wraps around
                    const bytesToEnd = this.buffer.length - this.readPosition;
                    this.buffer.copy(newBuffer, 0, this.readPosition, this.buffer.length);
                    this.buffer.copy(newBuffer, bytesToEnd, 0, this.writePosition);
                }
            }
            
            this.buffer = newBuffer;
            this.readPosition = 0;
            this.writePosition = this.availableBytes;
        } else if (this.writePosition + length > this.buffer.length) {
            // Need to compact/unwrap the buffer
            const newBuffer = Buffer.alloc(this.buffer.length);
            if (this.availableBytes > 0) {
                if (this.readPosition < this.writePosition) {
                    this.buffer.copy(newBuffer, 0, this.readPosition, this.writePosition);
                } else {
                    const bytesToEnd = this.buffer.length - this.readPosition;
                    this.buffer.copy(newBuffer, 0, this.readPosition, this.buffer.length);
                    this.buffer.copy(newBuffer, bytesToEnd, 0, this.writePosition);
                }
            }
            this.buffer = newBuffer;
            this.readPosition = 0;
            this.writePosition = this.availableBytes;
        }

        // Write new data
        data.copy(this.buffer, this.writePosition, 0, length);
        this.writePosition = (this.writePosition + length) % this.buffer.length;
        this.availableBytes += length;

        // Signal that data is available
        this.events.emit('data');
    }

    async read(n: number, timeout?: number): Promise<Buffer> {
        const timeoutMs = timeout !== undefined ? timeout : 10000;

        // Simple lock - wait if another read is in progress
        while (this.readLocked) {
            await new Promise(resolve => setImmediate(resolve));
        }
        this.readLocked = true;

        try {
            while (this.availableBytes < n) {
                if (this.closed) {
                    throw new Error(`Socket closed. Needed ${n} bytes, got ${this.availableBytes}.`);
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
                    throw new Error(`Timed out waiting for ${n} bytes, only got ${this.availableBytes}`);
                }
            }

            const data = Buffer.alloc(n);
            if (this.readPosition + n <= this.buffer.length) {
                // Data is contiguous
                this.buffer.copy(data, 0, this.readPosition, this.readPosition + n);
            } else {
                // Data wraps around
                const bytesToEnd = this.buffer.length - this.readPosition;
                this.buffer.copy(data, 0, this.readPosition, this.buffer.length);
                this.buffer.copy(data, bytesToEnd, 0, n - bytesToEnd);
            }
            
            this.readPosition = (this.readPosition + n) % this.buffer.length;
            this.availableBytes -= n;

            return data;
        } finally {
            this.readLocked = false;
        }
    }

    async write(data: Buffer, signal?: AbortSignal): Promise<void> {
        // Simple lock - wait if another write is in progress
        while (this.writeLocked) {
            await new Promise(resolve => setImmediate(resolve));
        }
        this.writeLocked = true;

        try {
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
        } finally {
            this.writeLocked = false;
        }
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
