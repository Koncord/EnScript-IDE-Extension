import { Logger } from "../../../util/logger";
import { BaseMessage, MessageType, DebugProtocol } from "./base-message";

export class DebugPoint {
    public unknown: number;
    public fileIndex: number;
    public lineNumber: number;
    constructor(unknown: number, fileIndex: number, lineNumber: number) {
        this.unknown = unknown;
        this.fileIndex = fileIndex;
        this.lineNumber = lineNumber;
    }

    public async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        await protocol.writeU32(this.unknown, signal);
        await protocol.writeU16(this.fileIndex, signal);
        await protocol.writeU16(this.lineNumber, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<DebugPoint> {
        const unknown = await protocol.readU32();
        const fileIndex = await protocol.readU16();
        const lineNumber = await protocol.readU16();
        return new DebugPoint(unknown, fileIndex, lineNumber);
    }
}

export class ModuleLoadMessage extends BaseMessage {
    public kind: MessageType = MessageType.LoadModule;
    public baseAddress: bigint;
    public paths: string[];
    public debugPoints?: DebugPoint[];
    public breakPoints?: number[];

    constructor(baseAddress: bigint, paths: string[], debugPoints?: DebugPoint[], breakPoints?: number[]) {
        super();
        this.baseAddress = baseAddress;
        this.paths = paths;
        this.debugPoints = debugPoints;
        this.breakPoints = breakPoints;
    }

    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        Logger.debug(`[SEND] [LOAD MODULE] Base Address: 0x${this.baseAddress.toString(16)}, Files Count: ${this.paths.length}, Debug Points Count: ${this.debugPoints ? this.debugPoints.length : 0}, Break Points Count: ${this.breakPoints ? this.breakPoints.length : 0}`);
        await protocol.writeU32(0, signal);
        await protocol.writeU64(this.baseAddress, signal);
        await protocol.writeU32(this.paths.length, signal);
        await protocol.writeU32(this.debugPoints ? this.debugPoints.length : 0, signal);
        await protocol.writeU32(this.breakPoints ? this.breakPoints.length : 0, signal);
        for (const path of this.paths) {
            await protocol.writeCStr(path, signal);
        }
        if (this.debugPoints) {
            for (const dp of this.debugPoints) {
                await dp.serialize(protocol, signal);
            }
        }
        if (this.breakPoints) {
            for (const bp of this.breakPoints) {
                await protocol.writeU32(bp, signal);
            }
        }
    }

    public static async deserialize(protocol: DebugProtocol): Promise<ModuleLoadMessage> {
        const len = await protocol.readU32();
        if (len != 0) {
            throw new Error(`[RECV] [LOAD MODULE] Invalid message length: ${len}`);
        }

        const baseAddress = await protocol.readU64();
        const filesCount = await protocol.readU32();
        const debugPointsCount = await protocol.readU32();
        const breakPointsCount = await protocol.readU32();

        Logger.debug(`[RECV] [LOAD MODULE] Base Address: 0x${baseAddress.toString(16)}, Files Count: ${filesCount}, Debug Points Count: ${debugPointsCount}, Break Points Count: ${breakPointsCount}`);

        const paths: string[] = [];
        for (let i = 0; i < filesCount; i++) {
            const path = await protocol.readCStr();
            paths.push(path);
        }
        const debugPoints: DebugPoint[] = [];
        for (let i = 0; i < debugPointsCount; i++) {
            const dp = await DebugPoint.deserialize(protocol);
            debugPoints.push(dp);
        }
        const breakPoints: number[] = [];
        for (let i = 0; i < breakPointsCount; i++) {
            const bp = await protocol.readU32();
            breakPoints.push(bp);
        }
        return new ModuleLoadMessage(baseAddress, paths, debugPoints, breakPoints);
    }
}
