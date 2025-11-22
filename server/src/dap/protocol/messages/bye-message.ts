import { Logger } from "../../../util/logger";
import { BaseMessage, DebugProtocol, MessageType } from "./base-message";

export class ByeMessage extends BaseMessage {
    public kind: MessageType = MessageType.Bye;

    constructor() {
        super();
    }
    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        // No payload
        Logger.debug(`[SEND] [BYE]`);
        await protocol.writeU32(0, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<ByeMessage> {
        const len = await protocol.readU32();
        if (len !== 0) {
            throw new Error(`[RECV] [BYE] Invalid message length: ${len}`);
        }
        Logger.debug(`[RECV] [BYE]`);
        return new ByeMessage();
    }
}
