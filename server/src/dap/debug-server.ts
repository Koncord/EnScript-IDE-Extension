import { Logger } from "../util";
import { DebugProtocol } from "./protocol/debug-protocol";
import { HelloMessage, MessageType } from "./protocol/messages";
import * as net from "net";
import { NetworkBuffer } from "./protocol/network-buffer";
import { DayZDebugAdapter, IDayZDebugListener } from "./dayz-debug-adapter";

const DZ_DEBUG_PORTS = [1000, 1001];
const PEER_TYPE_SERVER = "Server";
const PEER_TYPE_CLIENT = "Client";
const PEER_TYPE_CLIENT2 = "Client2";
const PEER_TYPE_CUSTOM = "Custom";

export class TcpDebugServer {
    private tcpListeners: net.Server[] = [];

    constructor(
        private readonly listener: IDayZDebugListener,
        private readonly debugPorts: number[] = DZ_DEBUG_PORTS
    ) { }

    public async startAsync(abortSignal: AbortSignal): Promise<void> {
        const tasks: Promise<void>[] = [];

        for (const port of this.debugPorts) {
            const tcpListener = net.createServer((socket) => {
                // Handle client connection asynchronously
                this.handleClientAsync(socket, port, abortSignal).catch((error) => {
                    Logger.error("Error in client handler:", error);
                });
            });

            const listenerTask = new Promise<void>((resolve, reject) => {
                tcpListener.listen(port, () => {
                    Logger.info(`TCP server listening on port ${port}`);
                });

                tcpListener.on('error', (error) => {
                    Logger.error(`TCP listener error on port ${port}:`, error);
                    reject(error);
                });

                // Handle abort signal
                abortSignal.addEventListener('abort', () => {
                    tcpListener.close(() => {
                        Logger.info(`TCP listener on port ${port} closed`);
                        resolve();
                    });
                });
            });

            this.tcpListeners.push(tcpListener);
            tasks.push(listenerTask);
        }

        Logger.info(`Listening on ports ${this.debugPorts.join(", ")}`);

        await Promise.all(tasks);
    }

    public stop(): void {
        for (const tcpListener of this.tcpListeners) {
            tcpListener.close();
        }
        this.tcpListeners = [];
    }

    private async handleClientAsync(
        client: net.Socket,
        serverPort: number,
        cancellationToken: AbortSignal
    ): Promise<void> {
        const clientAbortController = new AbortController();

        // Link parent cancellation token
        cancellationToken.addEventListener('abort', () => {
            clientAbortController.abort();
        });

        try {
            const endpoint = client.remoteAddress;
            const endpointPort = client.remotePort;
            const addr: [string, number] = [endpoint || 'unknown', endpointPort || 0];
            const peerType = serverPort === 1000 ? PEER_TYPE_CLIENT : (serverPort === 1001 ? PEER_TYPE_SERVER : (serverPort === 1002 ? PEER_TYPE_CLIENT2 : PEER_TYPE_CUSTOM));

            Logger.info(`DayZ port connected from ${addr[0]}:${addr[1]}`);

            const buffer = new NetworkBuffer(client);
            const protocol = new DebugProtocol(buffer);
            const port = new DayZDebugAdapter(addr, protocol, peerType);

            // Start buffer reading task with the linked cancellation token
            const bufferTask = buffer.start(clientAbortController.signal);

            // Receive hello message
            const msg = await protocol.processMessage(30000); // 30 seconds timeout
            if (msg.kind !== MessageType.Hello) {
                Logger.error("Expected HELLO message");
                return;
            }

            // Set PID from HELLO message
            port.pid = (msg as HelloMessage).processId;

            Logger.info(`DayZ port initialized (Pid: ${port.pid}, Peer: ${peerType})`);

            await this.listener.onConnectedAsync(port);

            try {
                await this.listener.onMessageAsync(port, msg);
                port.addListener(this.listener);

                // Run port message loop
                const portTask = port.runAsync(clientAbortController.signal);

                // Wait for either task to complete
                await Promise.race([bufferTask, portTask]);

                // Cancel the ongoing operations before cleanup
                clientAbortController.abort();

                // Give tasks a moment to complete gracefully
                try {
                    await Promise.race([
                        Promise.all([bufferTask, portTask]),
                        new Promise((resolve) => setTimeout(resolve, 2000))
                    ]);
                } catch (error) {
                    if ((error as Error).name === 'AbortError') {
                        // Expected when cancelling
                    } else {
                        Logger.warn("Error waiting for tasks to complete:", error);
                    }
                }
            } finally {
                Logger.info(`DayZ port disconnecting (Pid: ${port.pid})`);
                await this.listener.onDisconnectedAsync(port);
            }
        } catch (error) {
            Logger.error("Client handler error:", error);
        } finally {
            // Ensure cancellation is triggered
            clientAbortController.abort();
            client.destroy();
        }
    }
}
