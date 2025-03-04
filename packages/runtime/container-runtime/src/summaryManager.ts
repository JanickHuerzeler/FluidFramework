/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { EventEmitter } from "events";
import {
    IDisposable,
    ITelemetryLogger,
} from "@fluidframework/common-definitions";
import {
    IPromiseTimerResult,
    PromiseTimer,
} from "@fluidframework/common-utils";
import { ChildLogger, PerformanceEvent } from "@fluidframework/telemetry-utils";
import { IFluidObject, IRequest } from "@fluidframework/core-interfaces";
import {
    IContainerContext,
    LoaderHeader,
} from "@fluidframework/container-definitions";
import { ISequencedClient, MessageType } from "@fluidframework/protocol-definitions";
import { DriverHeader } from "@fluidframework/driver-definitions";
import { ISummarizer, createSummarizingWarning, ISummarizingWarning } from "./summarizer";
import { SummaryCollection } from "./summaryCollection";
import { ITrackedClient, OrderedClientElection, summarizerClientType, Throttler } from "./orderedClientElection";

const defaultInitialDelayMs = 5000;
const opsToBypassInitialDelay = 4000;

const defaultThrottleDelayWindowMs = 60 * 1000;
const defaultThrottleMaxDelayMs = 30 * 1000;
// default throttling function increases exponentially (0ms, 20ms, 60ms, 140ms, etc)
const defaultThrottleDelayFunction = (n: number) => 20 * (Math.pow(2, n) - 1);

enum SummaryManagerState {
    Off = 0,
    Starting = 1,
    Running = 2,
    Stopping = 3,
    Disabled = -1,
}

// Please note that all reasons in this list are not errors,
// and thus they are not raised today to parent container as error.
// If this needs to be changed in future, we should re-evaluate what and how we raise to summarizer
type StopReason = "parentNotConnected" | "parentShouldNotSummarize" | "disposed";
type ShouldSummarizeState =
    | { shouldSummarize: true; shouldStart: boolean; }
    | { shouldSummarize: false; stopReason: StopReason; };

export class SummaryManager extends EventEmitter implements IDisposable {
    private readonly logger: ITelemetryLogger;
    private readonly orderedClients: OrderedClientElection;
    private readonly initialDelayP: Promise<IPromiseTimerResult | void>;
    private readonly initialDelayTimer?: PromiseTimer;
    private electedClientId?: string;
    private clientId?: string;
    private latestClientId?: string;
    private connected = false;
    private state = SummaryManagerState.Off;
    private runningSummarizer?: ISummarizer;
    private _disposed = false;
    private readonly startThrottler = new Throttler(
        defaultThrottleDelayWindowMs,
        defaultThrottleMaxDelayMs,
        defaultThrottleDelayFunction,
    );
    private opsUntilFirstConnect = -1;

    public get summarizer() {
        return this.electedClientId;
    }

    public get disposed() {
        return this._disposed;
    }

    /** Used to calculate number of ops since last summary ack for the current elected client */
    private lastSummaryAckSeqForClient = 0;
    private hasSummarizersInQuorum: boolean;
    private hasLoggedTelemetry = false;

    constructor(
        private readonly context: IContainerContext,
        private readonly summaryCollection: SummaryCollection,
        private readonly summariesEnabled: boolean,
        parentLogger: ITelemetryLogger,
        private readonly maxOpsSinceLastSummary: number,
        initialDelayMs: number = defaultInitialDelayMs,
    ) {
        super();

        this.logger = ChildLogger.create(
            parentLogger,
            "SummaryManager",
            {all:{ clientId: () => this.latestClientId }});

        this.connected = context.connected;
        if (this.connected) {
            this.setClientId(context.clientId);
        }

        // Track ops until first (write) connect
        const opsUntilFirstConnectHandler = (clientId: string, details: ISequencedClient) => {
            if (this.opsUntilFirstConnect === -1 && clientId === this.clientId) {
                context.quorum.off("addMember", opsUntilFirstConnectHandler);
                this.opsUntilFirstConnect = details.sequenceNumber - this.context.deltaManager.initialSequenceNumber;
            }
        };
        context.quorum.on("addMember", opsUntilFirstConnectHandler);

        this.summaryCollection.on("default", (op) => {
            const opsSinceLastAckForClient = op.sequenceNumber - this.lastSummaryAckSeqForClient;
            if (
                opsSinceLastAckForClient > this.maxOpsSinceLastSummary
                && !this.hasLoggedTelemetry
                && this.electedClientId !== undefined
            ) {
                // Limit telemetry to only next client?
                this.logger.sendErrorEvent({
                    eventName: "ElectedClientNotSummarizing",
                    thisClientId: this.clientId,
                    electedClientId: this.electedClientId,
                    sequenceNumber: op.sequenceNumber,
                    lastSummaryAckSeqForClient: this.lastSummaryAckSeqForClient,
                });

                // In future we will change the elected client.
                // this.orderedClients.incrementCurrentClient();
            }
        });
        this.summaryCollection.on(MessageType.SummaryAck, (op) => {
            this.hasLoggedTelemetry = false;
            this.lastSummaryAckSeqForClient = op.sequenceNumber;
        });

        this.orderedClients = new OrderedClientElection(context.quorum);
        this.orderedClients.on("summarizerChange", (summarizerCount) => {
            const prev = this.hasSummarizersInQuorum;
            this.hasSummarizersInQuorum = summarizerCount > 0;
            if (prev !== this.hasSummarizersInQuorum) {
                this.refreshSummarizer();
            }
        });
        this.orderedClients.on("electedChange", (client: ITrackedClient | undefined) => {
            this.hasLoggedTelemetry = false;
            if (client !== undefined) {
                // set to join seq
                this.lastSummaryAckSeqForClient = client.sequenceNumber;
            }
            this.refreshSummarizer();
        });
        this.hasSummarizersInQuorum = this.orderedClients.getSummarizerCount() > 0;

        this.initialDelayTimer = new PromiseTimer(initialDelayMs, () => { });
        this.initialDelayP = this.initialDelayTimer?.start() ?? Promise.resolve();

        this.refreshSummarizer();
    }

    public setConnected(clientId: string) {
        this.updateConnected(true, clientId);
    }

    public setDisconnected() {
        this.updateConnected(false);
    }

    private setClientId(clientId: string | undefined): void {
        this.clientId = clientId;
        if (clientId !== undefined) {
            this.latestClientId = clientId;
            if (this.runningSummarizer !== undefined) {
                this.runningSummarizer.updateOnBehalfOf(clientId);
            }
        }
    }

    public on(event: "summarizer", listener: (clientId: string) => void): this;
    public on(event: string, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    private updateConnected(connected: boolean, clientId?: string) {
        if (this.connected === connected) {
            return;
        }

        this.connected = connected;
        this.setClientId(clientId);
        this.refreshSummarizer();
    }

    private getShouldSummarizeState(): ShouldSummarizeState {
        if (!this.connected) {
            return { shouldSummarize: false, stopReason: "parentNotConnected" };
        } else if (this.clientId !== this.summarizer) {
            return { shouldSummarize: false, stopReason: "parentShouldNotSummarize" };
        } else if (this.disposed) {
            return { shouldSummarize: false, stopReason: "disposed" };
        } else if (this.orderedClients.getSummarizerCount() > 0) {
            // Need to wait for any other existing summarizer clients to close,
            // because they can live longer than their parent container.
            // TODO: We will need to remove this check when we allow elected summarizer
            // to change, because they could get stuck in quorum.
            return { shouldSummarize: true, shouldStart: false };
        } else {
            return { shouldSummarize: true, shouldStart: true };
        }
    }

    private refreshSummarizer() {
        // Compute summarizer
        const newSummarizerClientId = this.orderedClients.getElectedClient()?.clientId;
        if (newSummarizerClientId !== this.electedClientId) {
            this.electedClientId = newSummarizerClientId;
            this.emit("summarizer", newSummarizerClientId);
        }

        // Transition states depending on shouldSummarize, which is a calculated
        // property that is only true if this client is connected and has the
        // computed summarizer client id
        const shouldSummarizeState = this.getShouldSummarizeState();
        switch (this.state) {
            case SummaryManagerState.Off: {
                if (shouldSummarizeState.shouldSummarize && shouldSummarizeState.shouldStart) {
                    this.start();
                }
                return;
            }
            case SummaryManagerState.Starting: {
                // Cannot take any action until summarizer is created
                // state transition will occur after creation
                return;
            }
            case SummaryManagerState.Running: {
                if (shouldSummarizeState.shouldSummarize === false) {
                    this.stop(shouldSummarizeState.stopReason);
                }
                return;
            }
            case SummaryManagerState.Stopping: {
                // Cannot take any action until running summarizer finishes
                // state transition will occur after it stops
                return;
            }
            case SummaryManagerState.Disabled: {
                // Never switch away from disabled state
                return;
            }
            default: {
                return;
            }
        }
    }

    private raiseContainerWarning(warning: ISummarizingWarning) {
        this.context.raiseContainerWarning(warning);
    }

    private start() {
        if (!this.summariesEnabled) {
            // If we should never summarize, lock in disabled state
            this.logger.sendTelemetryEvent({ eventName: "SummariesDisabled" });
            this.state = SummaryManagerState.Disabled;
            return;
        }
        if (this.context.clientDetails.type === summarizerClientType) {
            // Make sure that the summarizer client does not load another summarizer.
            this.state = SummaryManagerState.Disabled;
            return;
        }

        this.state = SummaryManagerState.Starting;

        // throttle creation of new summarizer containers to prevent spamming the server with websocket connections
        const delayMs = this.startThrottler.getDelay();
        if (delayMs >= defaultThrottleMaxDelayMs) {
            // we can't create a summarizer for some reason; raise error on container
            this.raiseContainerWarning(
                createSummarizingWarning("SummaryManager: CreateSummarizer Max Throttle Delay", false));
        }

        this.createSummarizer(delayMs).then((summarizer) => {
            summarizer.on("summarizingError",
                (warning: ISummarizingWarning) => this.raiseContainerWarning(warning));
            this.run(summarizer);
        }, (error) => {
            this.logger.sendErrorEvent({
                eventName: "CreateSummarizerError",
                attempt: this.startThrottler.attempts,
            }, error);
            this.tryRestart();
        });
    }

    private run(summarizer: ISummarizer) {
        this.state = SummaryManagerState.Running;

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const clientId = this.latestClientId!;
        this.runningSummarizer = summarizer;

        PerformanceEvent.timedExecAsync(
            this.logger,
            { eventName: "RunningSummarizer", attempt: this.startThrottler.attempts },
            async () => summarizer.run(clientId),
        ).finally(() => {
            this.runningSummarizer = undefined;
            this.tryRestart();
        });

        const shouldSummarizeState = this.getShouldSummarizeState();
        if (shouldSummarizeState.shouldSummarize === false) {
            this.stop(shouldSummarizeState.stopReason);
        }
    }

    private tryRestart(): void {
        const shouldSummarizeState = this.getShouldSummarizeState();
        if (shouldSummarizeState.shouldSummarize && shouldSummarizeState.shouldStart) {
            this.start();
        } else {
            this.state = SummaryManagerState.Off;
        }
    }

    private stop(reason: string) {
        this.state = SummaryManagerState.Stopping;

        if (this.runningSummarizer) {
            // Stopping the running summarizer client should trigger a change
            // in states when the running summarizer closes
            this.runningSummarizer.stop(reason);
        } else {
            // Should not be possible to hit this case
            this.logger.sendErrorEvent({ eventName: "StopCalledWithoutRunningSummarizer", reason });
            this.state = SummaryManagerState.Off;
        }
    }

    private async createSummarizer(delayMs: number): Promise<ISummarizer> {
        // We have been elected the summarizer. Some day we may be able to summarize with a live document but for
        // now we play it safe and launch a second copy.
        this.logger.sendTelemetryEvent({
            eventName: "CreatingSummarizer",
            delayMs,
            opsUntilFirstConnect: this.opsUntilFirstConnect,
        });

        const shouldDelay = delayMs > 0;
        const shouldInitialDelay = this.opsUntilFirstConnect < opsToBypassInitialDelay;
        if (shouldDelay || shouldInitialDelay) {
            await Promise.all([
                shouldInitialDelay ? this.initialDelayP : Promise.resolve(),
                shouldDelay ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve(),
            ]);
        }

        const loader = this.context.loader;

        // TODO eventually we may wish to spawn an execution context from which to run this
        const request: IRequest = {
            headers: {
                [LoaderHeader.cache]: false,
                [LoaderHeader.clientDetails]: {
                    capabilities: { interactive: false },
                    type: summarizerClientType,
                },
                [DriverHeader.summarizingClient]: true,
                [LoaderHeader.reconnect]: false,
                [LoaderHeader.sequenceNumber]: this.context.deltaManager.lastSequenceNumber,
            },
            url: "/_summarizer",
        };

        const response = await loader.request(request);

        if (response.status !== 200
            || (response.mimeType !== "fluid/object" && response.mimeType !== "fluid/component")) {
            return Promise.reject(new Error("Invalid summarizer route"));
        }

        const rawFluidObject = response.value as IFluidObject;
        const summarizer = rawFluidObject.ISummarizer;

        if (!summarizer) {
            return Promise.reject(new Error("Fluid object does not implement ISummarizer"));
        }

        return summarizer;
    }

    public dispose() {
        this.initialDelayTimer?.clear();
        this._disposed = true;
    }
}
