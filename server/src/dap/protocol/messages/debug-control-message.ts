import { Logger } from "../../../util/logger";
import { BaseMessage, MessageType, DebugProtocol } from "./base-message";

export enum DebugControlCommand {
    SetBreakpoint = 0x8,
    StepIn = 0xC,
    StepOver = 0xD,
    StepOut = 0xE,
    Continue = 0xF,
}

export class DebugControlMessage extends BaseMessage {
    public kind: MessageType = MessageType.DebugControl;
    public breakpoints: Map<bigint, number[]>;
    public command: DebugControlCommand;

    constructor(command: DebugControlCommand, breakpoints: Map<bigint, number[]>) {
        super();
        this.command = command;
        this.breakpoints = breakpoints;
    }

    public override async serialize(protocol: DebugProtocol, signal?: AbortSignal): Promise<void> {
        await protocol.writeU32(0, signal);
        const totalBreakpoints = Array.from(this.breakpoints.values()).reduce((sum, codePoints) => sum + codePoints.length, 0);
        Logger.debug(`[SEND] [DEBUG CONTROL] Command: ${DebugControlCommand[this.command]}, Total Breakpoints: ${totalBreakpoints}`);
        await protocol.writeU32(totalBreakpoints, signal);
        for (const [moduleAddr, codePoints] of this.breakpoints) {
            for (const cp of codePoints) {
                await protocol.writeU64(moduleAddr, signal);
                await protocol.writeU32(cp, signal);
            }
        }
        await protocol.writeU32(this.command, signal);
        await protocol.writeU32(0, signal); // unknown
    }

    public static async deserialize(protocol: DebugProtocol): Promise<DebugControlMessage> {
        const len = await protocol.readU32();
        if (len !== 0) {
            throw new Error(`[RECV] [DEBUG CONTROL] Invalid message length: ${len}`);
        }
        const bpCount = await protocol.readU32();
        const breakpoints = new Map<bigint, number[]>();
        for (let i = 0; i < bpCount; i++) {
            const moduleAddr = await protocol.readU64();
            const cpIdx = await protocol.readU32();
            if (!breakpoints.has(moduleAddr)) {
                breakpoints.set(moduleAddr, []);
            }
            breakpoints.get(moduleAddr)!.push(cpIdx);
        }
        const command = await protocol.readU32();
        const unknown = await protocol.readU32(); // unknown
        if (unknown !== 0) {
            throw new Error(`[RECV] [DEBUG CONTROL] Invalid unknown field: ${unknown}`);
        }
        return new DebugControlMessage(command, breakpoints);
    }
}
