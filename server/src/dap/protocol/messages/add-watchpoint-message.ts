import { Logger } from "../../../util/logger";
import { BaseMessage, DebugProtocol, MessageType } from "./base-message";

export class AddWatchpointMessage extends BaseMessage {
    public kind: MessageType = MessageType.AddWatch;
    public unknown2: number;
    public flag: number;
    public watchpointIndex: number;

    constructor(unknown2: number, flag: number, watchpointIndex: number) {
        super();
        this.unknown2 = unknown2;
        this.flag = flag;
        this.watchpointIndex = watchpointIndex;
    }

    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        Logger.debug(`[SEND] [ADD WATCHPOINT] Unknown2: ${this.unknown2}, Flag: ${this.flag}, Watchpoint Index: ${this.watchpointIndex}`);
        await protocol.writeU32(0, signal);
        await protocol.writeU32(this.unknown2, signal);
        await protocol.writeU32(this.flag, signal);
        await protocol.writeU32(this.watchpointIndex, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<AddWatchpointMessage> {
        Logger.debug(`[RECV] [ADD WATCHPOINT]`);
        const unknown1 = await protocol.readU32();
        if (unknown1 !== 0) {
            Logger.warn(`[RECV] [ADD WATCHPOINT] Expected unknown field to be 0, but got ${unknown1}`);
        }
        const unknown2 = await protocol.readU32();
        const flag = await protocol.readU32();
        const watchpointIndex = await protocol.readU32();
        return new AddWatchpointMessage(unknown2, flag, watchpointIndex);
    }
}
