import { DebugProtocol } from '../debug-protocol';

export enum MessageType {
    Unknown0 = 0x0,
    Hello = 0x1,
    Bye = 0x2,
    Unknown3 = 0x3,
    LoadModule = 0x4,
    UnloadModule = 0x5,
    Callstack = 0x6,
    Watchpoints = 0x7,
    UJnknown8 = 0x8,
    DebugControl = 0x9,
    ExecuteCode = 0xA,
    Recompile = 0xB,
    UnknownC = 0xC,
    UnknownD = 0xD,
    UnknownE = 0xE,
    UnknownF = 0xF,
    Unknown10 = 0x10,
    Unknown11 = 0x11,
    Unknown12 = 0x12,
    Unknown13 = 0x13,
    Log = 0x14,
    AddWatch = 0x15
}

export abstract class BaseMessage {
    public abstract kind: MessageType;

    public async serialize(_protocol: DebugProtocol, _signal?: AbortSignal): Promise<void> {
        throw new Error("Method not implemented.");
    }
}

export { DebugProtocol } from '../debug-protocol';