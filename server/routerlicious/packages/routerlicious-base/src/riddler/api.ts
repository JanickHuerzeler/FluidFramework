/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { getRandomName } from "@fluidframework/server-services-client";
import {
    MongoManager,
    ISecretManager,
    ITenantStorage,
    ITenantOrderer,
    ITenantCustomData,
} from "@fluidframework/server-services-core";
import { Router } from "express";
import { getParam } from "@fluidframework/server-services-utils";
import * as winston from "winston";
import { handleResponse } from "../utils";
import { TenantManager } from "./tenantManager";

export function create(
    collectionName: string,
    mongoManager: MongoManager,
    baseOrderUrl: string,
    defaultHistorianUrl: string,
    defaultInternalHistorianUrl: string,
    secretManager: ISecretManager,
): Router {
    const router: Router = Router();
    const manager = new TenantManager(
        mongoManager,
        collectionName,
        baseOrderUrl,
        defaultHistorianUrl,
        defaultInternalHistorianUrl,
        secretManager);

    /**
     * Validates a tenant token. This only confirms that the token was correctly signed by the given tenant.
     * Clients still need to verify the claims.
     */
    router.post("/tenants/:id/validate", (request, response) => {
        winston.info(`POST /tenants/:id/validate (request.params: ${JSON.stringify(request.params)})`);
        const validP = manager.validateToken(getParam(request.params, "id"), request.body.token);
        handleResponse(validP, response);
    });

    /**
     * Retrieves details for the given tenant
     */
    router.get("/tenants/:id", (request, response) => {
        const tenantId = getParam(request.params, "id");
        const tenantP = manager.getTenant(tenantId);
        handleResponse(tenantP, response);
    });

    /**
     * Retrieves list of all tenants
     */
    router.get("/tenants", (request, response) => {
        const tenantP = manager.getAllTenants();
        handleResponse(tenantP, response);
    });

    /**
     * Retrieves the api key for the tenant
     */
    router.get("/tenants/:id/key", (request, response) => {
        const tenantP = manager.getTenantKey(getParam(request.params, "id"));
        handleResponse(tenantP, response);
    });

    /**
     * Updates the storage provider for the given tenant
     */
    router.put("/tenants/:id/storage", (request, response) => {
        const storageP = manager.updateStorage(getParam(request.params, "id"), request.body);
        handleResponse(storageP, response);
    });

    /**
     * Updates the orderer for the given tenant
     */
    router.put("/tenants/:id/orderer", (request, response) => {
        const storageP = manager.updateOrderer(getParam(request.params, "id"), request.body);
        handleResponse(storageP, response);
    });

    /**
     * Updates the customData for the given tenant
     */
    router.put("/tenants/:id/customData", (request, response) => {
        const tenantId = getParam(request.params, "id");
        const customDataP = manager.updateCustomData(tenantId, request.body);
        handleResponse(customDataP, response);
    });

    /**
     * Refreshes the key for the given tenant
     */
    router.put("/tenants/:id/key", (request, response) => {
        const tenantId = getParam(request.params, "id");
        const refreshKeyP = manager.refreshTenantKey(tenantId);
        return handleResponse(refreshKeyP, response);
    });

    /**
     * Creates a new tenant
     */
    router.post("/tenants/:id?", (request, response) => {
        const tenantId = getParam(request.params, "id") || getRandomName("-");
        const tenantStorage: ITenantStorage = request.body.storage ? request.body.storage : null;
        const tenantOrderer: ITenantOrderer = request.body.orderer ? request.body.orderer : null;
        const tenantCustomData: ITenantCustomData = request.body.customData ? request.body.customData : {};
        const tenantP = manager.createTenant(
            tenantId,
            tenantStorage,
            tenantOrderer,
            tenantCustomData,
        );
        handleResponse(tenantP, response);
    });

    /**
     * Deletes a tenant by adding a disabled flag
     */
    router.delete("/tenants/:id", (request, response) => {
        const tenantId = getParam(request.params, "id");
        const tenantP = manager.disableTenant(tenantId);
        handleResponse(tenantP, response);
    });

    return router;
}
