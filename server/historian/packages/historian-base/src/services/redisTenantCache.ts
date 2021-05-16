/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { Redis } from "ioredis";
import * as winston from "winston";
import { IRedisParameters } from "./definitions";
/**
 * Redis based cache client for caching and expiring tenants and tokens.
 */
export class RedisTenantCache {
    private readonly expireAfterSeconds: number = 60 * 60 * 24;
    private readonly prefix: string = "tenant";

    constructor(
        private readonly client: Redis,
        parameters?: IRedisParameters) {
        if (parameters?.expireAfterSeconds) {
            this.expireAfterSeconds = parameters.expireAfterSeconds;
            winston.info(`RedisTenantCache.ctor: expireAfterSeconds=${this.expireAfterSeconds} from IRedisParameters`);
        }

        if (parameters?.prefix) {
            this.prefix = parameters.prefix;
        }

        client.on("error", (error) => {
            winston.error("Redis Tenant Cache Error:", error);
        });
    }

    public async exists(item: string): Promise<boolean> {
        const result = await this.client.exists(this.getKey(item));
        return result >= 1;
    }

    public async set(
        key: string,
        value: string = "",
        expireAfterSeconds: number = this.expireAfterSeconds): Promise<void> {
        winston.info(`RedisTenantCache.set(expireAfterSeconds: ${expireAfterSeconds})`);
        const result = await this.client.set(this.getKey(key), value, "EX", expireAfterSeconds);
        if (result !== "OK")
        {
            winston.info(`result was not OK: ${result}`);
            return Promise.reject(result);
        }
    }

    public async get(key: string): Promise<string> {
        return this.client.get(this.getKey(key));
    }

    /**
     * Translates the input item to the one we will actually store in redis
     */
    private getKey(item: string): string {
        return `${this.prefix}:${item}`;
    }
}
