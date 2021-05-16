/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { CollaborativeText } from "./fluid-object";
import { CollaborativeTextContainer } from "./container";
import { FluidFormInitialize } from "./FluidFormInitialize";
import { RouterliciousClient } from "./RouterliciousClient";
import { containerSchema } from "./schemas/container-schema";

// Re-export everything
export { CollaborativeText as CollaborativeTextExample, CollaborativeTextContainer };

// Since this is a single page Fluid application we are generating a new document id
// if one was not provided
let createNew = false;
if (window.location.hash.length === 0) {
    createNew = true;
    window.location.hash = Date.now().toString();
}
const documentId = window.location.hash.substring(1);

/**
 * This is a helper function for loading the page. It's required because getting the Fluid Container
 * requires making async calls.
 */
async function start() {
    const fluidFormInitialize = new FluidFormInitialize();

    if(createNew){
        fluidFormInitialize.initializeContainer(documentId);
    }

    const container = await RouterliciousClient.getContainer(
        { id: documentId },
        containerSchema
    );

    let collaborativeTextObject: CollaborativeText;

    if (
        container.initialObjects.collaborativeText instanceof CollaborativeText
    ) {
        // Get default data object as FluidFormRootDataObject
        collaborativeTextObject = container.initialObjects.collaborativeText;
    } else {
        throw new Error("Could not cast container schema.");
    }

    // For now we will just reach into the FluidObject to render it
    const contentDiv = document.getElementById("content");
    // eslint-disable-next-line no-null/no-null
    if (contentDiv !== null) {
        collaborativeTextObject.render(contentDiv);
    }

    // Setting "fluidStarted" is just for our test automation
    // eslint-disable-next-line @typescript-eslint/dot-notation
    window["fluidStarted"] = true;
}

start().catch((e) => {
    console.error(e);
    console.log("%cEnsure you are running the Tinylicious Fluid Server\nUse:`npm run start:server`", "font-size:30px");
});
