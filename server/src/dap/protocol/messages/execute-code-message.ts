import { Logger } from "../../../util/logger";
import { BaseMessage, MessageType, DebugProtocol } from "./base-message";

export class ExecuteCodeMessage extends BaseMessage {
    public kind: MessageType = MessageType.ExecuteCode;
    public moduleName: string;
    public code: string;

    constructor(moduleName: string, code: string) {
        super();
        this.moduleName = moduleName;
        this.code = code;
    }

    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        Logger.debug(`[SEND] [EXECUTE CODE] Module Name: ${this.moduleName}, Code Length: ${this.code.length}`);
        await protocol.writeU32(0, signal);
        await protocol.writeCStr(this.moduleName, signal);
        await protocol.writeU32(0, signal); // unknown, seems always 0
        await protocol.writeCStr(this.code, signal);
    }

    public static async deserialize(protocol: DebugProtocol): Promise<ExecuteCodeMessage> {
        const len = await protocol.readU32();
        if (len != 0) {
            throw new Error(`[RECV] [EXECUTE CODE] Invalid message length: ${len}`);
        }
        const moduleName = await protocol.readCStr();
        const unknown = await protocol.readU32();
        if (unknown !== 0) {
            throw new Error(`[RECV] [EXECUTE CODE] Invalid unknown field: ${unknown}`);
        }
        const code = await protocol.readCStr();
        Logger.debug(`[RECV] [EXECUTE CODE] Module Name: ${moduleName}, Code Length: ${code.length}`);
        return new ExecuteCodeMessage(moduleName, code);
    }
}