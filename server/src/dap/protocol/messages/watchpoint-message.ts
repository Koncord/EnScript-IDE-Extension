import { Logger } from "../../../util/logger";
import { BaseMessage, DebugProtocol, MessageType } from "./base-message";

export class WatchpointEntry {
    public Unknown1: number; // 2 bytes
    public Number: number; // 2 bytes
    public Unknown3: number; // 2 bytes. always 65535 ? maybe its -1 in signed?
    public Unknown4: number; // 2 bytes
    public DisplayValue: string;

    constructor(unknown1: number, number: number, unknown3: number, unknown4: number, displayValue: string) {
        this.Unknown1 = unknown1;
        this.Number = number;
        this.Unknown3 = unknown3;
        this.Unknown4 = unknown4;
        this.DisplayValue = displayValue;
    }

    public async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        await protocol.writeU16(this.Unknown1, signal);
        await protocol.writeU16(this.Number, signal);
        await protocol.writeU16(this.Unknown3, signal);
        await protocol.writeU16(this.Unknown4, signal);
        await protocol.writeCStr(this.DisplayValue, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<WatchpointEntry> {
        const unknown1 = await protocol.readU16();
        const number = await protocol.readU16();
        const unknown3 = await protocol.readU16();
        const unknown4 = await protocol.readU16();
        const displayValue = await protocol.readCStr();
        return new WatchpointEntry(unknown1, number, unknown3, unknown4, displayValue);
    }
}

export class WatchpointMessage extends BaseMessage {
    public kind: MessageType = MessageType.Watchpoints;
    public watchpoints: WatchpointEntry[];

    constructor(watchpoints: WatchpointEntry[]) {
        super();
        this.watchpoints = watchpoints;
    }

    public override async serialize(protocol: DebugProtocol): Promise<void> {
        Logger.debug(`[SEND] [WATCHPOINT] Entries: ${this.watchpoints.length}`);
        await protocol.writeU32(0);
        await protocol.writeU32(this.watchpoints.length);

        for (const entry of this.watchpoints) {
            await entry.serialize(protocol);
        }
    }

    public static async deserialize(protocol: DebugProtocol): Promise<WatchpointMessage> {
        const unknown = await protocol.readU32();
        if (unknown !== 0) {
            Logger.warn(`[RECV] [WATCHPOINT] Expected unknown field to be 0, but got ${unknown}`);
        }
        const count = await protocol.readU32();
        const watchpoints: WatchpointEntry[] = [];
        for (let i = 0; i < count; i++) {
            const entry = await WatchpointEntry.deserialize(protocol);
            watchpoints.push(entry);
        }
        Logger.debug(`[RECV] [WATCHPOINT] Entries: ${watchpoints.length}`);
        return new WatchpointMessage(watchpoints);
    }
}
