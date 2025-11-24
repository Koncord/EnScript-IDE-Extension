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
        await protocol.writeU16(this.lineNumber, signal);
        await protocol.writeU16(this.fileIndex, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<DebugPoint> {
        const unknown = await protocol.readU32();
        const lineNumber = await protocol.readU16();
        const fileIndex = await protocol.readU16();
        return new DebugPoint(unknown, fileIndex, lineNumber);
    }
}

export class DebugModule {
    public baseAddress: bigint;
    public paths: string[];
    public debugPoints?: DebugPoint[];
    public breakPoints?: number[]; // breakpoints from previous session
    constructor(baseAddress: bigint, paths: string[], debugPoints?: DebugPoint[], breakPoints?: number[]) {
        this.baseAddress = baseAddress;
        this.paths = paths;
        this.debugPoints = debugPoints;
        this.breakPoints = breakPoints;
    }
}

export class ModuleLoadMessage extends BaseMessage {
    public kind: MessageType = MessageType.LoadModule;
    public module: DebugModule;

    constructor(baseAddress: bigint, paths: string[], debugPoints?: DebugPoint[], breakPoints?: number[]) {
        super();
        this.module = new DebugModule(baseAddress, paths, debugPoints, breakPoints);
    }

    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        Logger.debug(`[SEND] [LOAD MODULE] Base Address: 0x${this.module.baseAddress.toString(16)}, Files Count: ${this.module.paths.length}, Debug Points Count: ${this.module.debugPoints ? this.module.debugPoints.length : 0}, Break Points Count: ${this.module.breakPoints ? this.module.breakPoints.length : 0}`);
        await protocol.writeU32(0, signal);
        await protocol.writeU64(this.module.baseAddress, signal);
        await protocol.writeU32(this.module.paths.length, signal);
        await protocol.writeU32(this.module.debugPoints ? this.module.debugPoints.length : 0, signal);
        await protocol.writeU32(this.module.breakPoints ? this.module.breakPoints.length : 0, signal);

        for (const path of this.module.paths) {
            await protocol.writeCStr(path, signal);
        }

        if (this.module.debugPoints) {
            for (const dp of this.module.debugPoints) {
                await dp.serialize(protocol, signal);
            }
        }

        if (this.module.breakPoints) {
            for (const bp of this.module.breakPoints) {
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
