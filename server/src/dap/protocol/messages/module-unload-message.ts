import { Logger } from "../../../util/logger";
import { BaseMessage, MessageType, DebugProtocol } from "./base-message";

export class ModuleUnloadMessage extends BaseMessage {
    public kind: MessageType = MessageType.UnloadModule;
    public baseAddress: bigint;

    constructor(baseAddress: bigint) {
        super();
        this.baseAddress = baseAddress;
    }

    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        Logger.debug(`[SEND] [UNLOAD MODULE] Base Address: 0x${this.baseAddress.toString(16)}`);
        await protocol.writeU32(0, signal);
        await protocol.writeU64(this.baseAddress, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<ModuleUnloadMessage> {
        const len = await protocol.readU32();
        if (len != 0) {
            throw new Error(`[RECV] [UNLOAD MODULE] Invalid message length: ${len}`);
        }
        const baseAddress = await protocol.readU64();
        Logger.debug(`[RECV] [UNLOAD MODULE] Base Address: 0x${baseAddress.toString(16)}`);
        return new ModuleUnloadMessage(baseAddress);
    }
}
