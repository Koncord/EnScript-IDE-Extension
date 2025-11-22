import { Logger } from "../../../util/logger";
import { BaseMessage, MessageType, DebugProtocol } from "./base-message";

export class RecompileMessage extends BaseMessage {
    public kind: MessageType = MessageType.Recompile;
    public moduleAddress: bigint;
    public fileIndex: number;

    constructor(moduleAddress: bigint, fileIndex: number) {
        super();
        this.moduleAddress = moduleAddress;
        this.fileIndex = fileIndex;
    }

    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        Logger.debug(`[SEND] [RECOMPILE] Module Address: 0x${this.moduleAddress.toString(16)}, File Index: ${this.fileIndex}`);
        await protocol.writeU32(0, signal);
        await protocol.writeU32(1, signal); // unknown, seems always 0x1
        await protocol.writeU64(this.moduleAddress, signal);
        await protocol.writeU32(this.fileIndex, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<RecompileMessage> {
        const len = await protocol.readU32();
        if (len != 0) {
            throw new Error(`[RECV] [RECOMPILE] Invalid message length: ${len}`);
        }

        const unknown = await protocol.readU32();
        if (unknown !== 1) {
            throw new Error(`[RECV] [RECOMPILE] Invalid unknown field: ${unknown}`);
        }
        const moduleAddress = await protocol.readU64();
        const fileIndex = await protocol.readU32();
        Logger.debug(`[RECV] [RECOMPILE] Module Address: 0x${moduleAddress.toString(16)}, File Index: ${fileIndex}`);
        return new RecompileMessage(moduleAddress, fileIndex);
    }
}
