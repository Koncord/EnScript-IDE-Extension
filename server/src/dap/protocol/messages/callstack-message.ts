import { Logger } from "../../../util/logger";
import { BaseMessage, DebugProtocol, MessageType } from "./base-message";

export class CallstackEntry {
     public static readonly CLASS_NAME_SIZE = 24;
    public static readonly FUNCTION_NAME_SIZE = 36;
    public static readonly ENTRY_SIZE = 8 + 4 + CallstackEntry.CLASS_NAME_SIZE + CallstackEntry.FUNCTION_NAME_SIZE; // moduleAddress (8) + codePointIndex (4) + className (24) + functionName (36) = 72 bytes
    public moduleAddress: bigint;
    public codePointIndex: number;
    public className: string;
    public functionName: string;

    constructor(moduleAddress: bigint, codePointIndex: number, className: string, functionName: string) {
        this.moduleAddress = moduleAddress;
        this.codePointIndex = codePointIndex;
        this.className = className;
        this.functionName = functionName;
    }

    public async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        await protocol.writeU64(this.moduleAddress, signal);
        await protocol.writeU32(this.codePointIndex, signal);
        await protocol.writeRawString(this.className, CallstackEntry.CLASS_NAME_SIZE, signal);
        await protocol.writeRawString(this.functionName, CallstackEntry.FUNCTION_NAME_SIZE, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<CallstackEntry> {
        const moduleAddress = await protocol.readU64();
        const codePointIndex = await protocol.readU32();
        const className = await protocol.readRawString(CallstackEntry.CLASS_NAME_SIZE);
        const functionName = await protocol.readRawString(CallstackEntry.FUNCTION_NAME_SIZE);
        return new CallstackEntry(moduleAddress, codePointIndex, className, functionName);
    }
}

export class CallstackMessage extends BaseMessage {
    public kind: MessageType = MessageType.Callstack;
    public moduleAddress: bigint;
    public codePointIndex: number;
    public entries: CallstackEntry[];

    constructor(moduleAddress: bigint, codePointIndex: number, entries: CallstackEntry[]) {
        super();
        this.moduleAddress = moduleAddress;
        this.codePointIndex = codePointIndex;
        this.entries = entries;
    }

    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        Logger.debug(`[SEND] [CALLSTACK] Module Address: 0x${this.moduleAddress.toString(16)}, Code Point Index: ${this.codePointIndex}, Entries: ${this.entries.length}`);
        const payloadLength = 8 + 4 + 4 + 4 + 4 + (this.entries.length * CallstackEntry.ENTRY_SIZE);
        await protocol.writeU32(payloadLength, signal);
        await protocol.writeU64(this.moduleAddress, signal);
        await protocol.writeU32(this.codePointIndex, signal);
        await protocol.writeU32(this.entries.length, signal);

        await protocol.writeU32(1, signal); // unknown, always 1?
        await protocol.writeU32(0, signal); // unknown, always 0?

        for (const entry of this.entries) {
            await entry.serialize(protocol, signal);
        }
    }

    public static async deserialize(protocol: DebugProtocol): Promise<CallstackMessage> {
        const _len = await protocol.readU32();
        const moduleAddress = await protocol.readU64();
        const codePointIndex = await protocol.readU32();
        const entryCount = await protocol.readU32();
        const unknown1 = await protocol.readU32(); // unknown
        if (unknown1 !== 1) {
            Logger.warn(`[CALLSTACK] Unexpected unknown1 value: ${unknown1}`);
        }
        const unknown2 = await protocol.readU32(); // unknown
        if (unknown2 !== 0) {
            Logger.warn(`[CALLSTACK] Unexpected unknown2 value: ${unknown2}`);
        }
        const entries: CallstackEntry[] = [];
        for (let i = 0; i < entryCount; i++) {
            const entry = await CallstackEntry.deserialize(protocol);
            entries.push(entry);
        }
        Logger.debug(`[RECV] [CALLSTACK] Module Address: 0x${moduleAddress.toString(16)}, Code Point Index: ${codePointIndex}, Entries: ${entries.length}`);
        return new CallstackMessage(moduleAddress, codePointIndex, entries);
    }
}
