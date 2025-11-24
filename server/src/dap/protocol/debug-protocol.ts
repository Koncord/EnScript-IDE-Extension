import {
    BaseMessage, MessageType,
    HelloMessage,
    ByeMessage,
    ModuleLoadMessage,
    ModuleUnloadMessage,
    LogMessage,
    DebugControlMessage,
    RecompileMessage,
    ExecuteCodeMessage,
    CallstackMessage,
    WatchpointMessage,
    AddWatchpointMessage,
} from './messages';
import { NetworkBuffer } from './network-buffer';

export class DebugProtocol {
    private writeLocked = false;

    constructor(private readonly buffer: NetworkBuffer) { }

    async readRaw(n: number, timeout?: number): Promise<Buffer> {
        return await this.buffer.read(n, timeout);
    }

    async readU8(timeout?: number): Promise<number> {
        const data = await this.readRaw(1, timeout);
        return data[0];
    }

    async readU16(timeout?: number): Promise<number> {
        const data = await this.readRaw(2, timeout);
        return data.readUInt16LE(0);
    }

    async readU32(timeout?: number): Promise<number> {
        const data = await this.readRaw(4, timeout);
        return data.readUInt32LE(0);
    }

    async readU64(timeout?: number): Promise<bigint> {
        const data = await this.readRaw(8, timeout);
        return data.readBigUInt64LE(0);
    }

    async readArray(timeout?: number): Promise<Buffer> {
        const length = await this.readU32(timeout);
        if (length === 0) return Buffer.alloc(0);

        return await this.readRaw(length, timeout);
    }

    async readRawString(length: number, timeout?: number): Promise<string> {
        const buf = await this.readRaw(length, timeout);
        // Find null terminator
        const nullIdx = buf.indexOf(0);
        const trimmedBuf = nullIdx >= 0 ? buf.subarray(0, nullIdx) : buf;
        return trimmedBuf.toString('utf8');
    }

    async readCStr(timeout?: number): Promise<string> {
        const length = await this.readU32(timeout);
        if (length === 0) return '';

        const buf = await this.readRaw(length, timeout);

        // Remove trailing null if present
        const effectiveLength = (buf.length > 0 && buf[buf.length - 1] === 0)
            ? buf.length - 1
            : buf.length;

        return buf.toString('utf8', 0, effectiveLength);
    }

    async writeRaw(data: Buffer, signal?: AbortSignal): Promise<void> {
        await this.buffer.write(data, signal);
    }

    async writeU16(value: number, signal?: AbortSignal): Promise<void> {
        const buf = Buffer.allocUnsafe(2);
        buf.writeUInt16LE(value, 0);
        await this.writeRaw(buf, signal);
    }

    async writeU32(value: number, signal?: AbortSignal): Promise<void> {
        const buf = Buffer.allocUnsafe(4);
        buf.writeUInt32LE(value, 0);
        await this.writeRaw(buf, signal);
    }

    async writeU64(value: bigint, signal?: AbortSignal): Promise<void> {
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigUInt64LE(value, 0);
        await this.writeRaw(buf, signal);
    }

    async writeArray(data: Buffer, signal?: AbortSignal): Promise<void> {
        await this.writeU32(data.length, signal);
        if (data.length > 0) await this.writeRaw(data, signal);
    }

    async writeCStr(text: string, signal?: AbortSignal): Promise<void> {
        await this.writeArray(Buffer.from(text, 'utf8'), signal);
    }

    async writeRawString(text: string, length: number, signal?: AbortSignal): Promise<void> {
        const strBytes = Buffer.from(text, 'utf8');
        if (strBytes.length >= length) {
            // Truncate
            await this.writeRaw(strBytes.subarray(0, length), signal);
        } else {
            // Write string + null terminator + padding
            const paddedBytes = Buffer.alloc(length);
            strBytes.copy(paddedBytes, 0);
            paddedBytes[strBytes.length] = 0; // null terminator
            await this.writeRaw(paddedBytes, signal);
        }
    }

    async processMessage(timeout?: number): Promise<BaseMessage> {
        const tag = await this.readU32(timeout);
        switch (tag as MessageType) {
            case MessageType.Hello:
                return await HelloMessage.deserialize(this);
            case MessageType.Bye:
                return await ByeMessage.deserialize(this);
            case MessageType.LoadModule:
                return await ModuleLoadMessage.deserialize(this);
            case MessageType.UnloadModule:
                return await ModuleUnloadMessage.deserialize(this);
            case MessageType.Log:
                return await LogMessage.deserialize(this);
            case MessageType.DebugControl:
                return await DebugControlMessage.deserialize(this);
            case MessageType.Recompile:
                return await RecompileMessage.deserialize(this);
            case MessageType.ExecuteCode:
                return await ExecuteCodeMessage.deserialize(this);
            case MessageType.Callstack:
                return await CallstackMessage.deserialize(this);
            case MessageType.Watchpoints:
                return await WatchpointMessage.deserialize(this);
            case MessageType.AddWatch:
                return await AddWatchpointMessage.deserialize(this);
            default:
                throw new Error(`Unknown message tag: 0x${tag.toString(16)} (decimal: ${tag})`);
        }
    }

    async sendMessage(message: BaseMessage, signal?: AbortSignal): Promise<void> {
        // Simple lock - wait if another write is in progress
        while (this.writeLocked) {
            await new Promise(resolve => setImmediate(resolve));
        }
        this.writeLocked = true;

        try {
            await this.writeU32(message.kind, signal);
            await message.serialize(this, signal);
        } finally {
            this.writeLocked = false;
        }
    }
}
