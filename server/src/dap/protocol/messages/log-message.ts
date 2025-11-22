import { Logger } from "../../../util/logger";
import { BaseMessage, MessageType, DebugProtocol } from "./base-message";

export class LogMessage extends BaseMessage {
    public kind: MessageType = MessageType.Log;
    public message: string;

    constructor(message: string) {
        super();
        this.message = message;
    }

    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        Logger.debug(`[SEND] [LOG] Message: ${this.message}`);
        await protocol.writeU32(0, signal);
        await protocol.writeCStr(this.message, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<LogMessage> {
        const len = await protocol.readU32();
        if (len != 0) {
            throw new Error(`[RECV] [LOG] Invalid message length: ${len}`);
        }
        const message = await protocol.readCStr();
        Logger.debug(`[RECV] [LOG] Message: ${message}`);
        return new LogMessage(message);
    }
}
