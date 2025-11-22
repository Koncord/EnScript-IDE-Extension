import { Logger } from "../../../util";
import { BaseMessage, MessageType, DebugProtocol } from "./base-message";

export class HelloMessage extends BaseMessage {
    public kind: MessageType = MessageType.Hello;
    public processId: number;

    constructor(processId: number) {
        super();
        this.processId = processId;
    }

    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        Logger.debug(`[SEND] [HELLO] Process ID: ${this.processId}`);
        await protocol.writeU32(4, signal);
        await protocol.writeU32(this.processId, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<HelloMessage> {
        const len = await protocol.readU32();
        if (len !== 4) {
            throw new Error(`[RECV] [HELLO] Invalid message length: ${len}`);
        }
        const processId = await protocol.readU32();
        Logger.debug(`[RECV] [HELLO] Process ID: ${processId}`);
        return new HelloMessage(processId);
    }
}
