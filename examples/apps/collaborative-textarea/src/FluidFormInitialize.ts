import {
    RouterliciousClient,
    ExternalRouterliciousConfig,
} from "./RouterliciousClient";
import {containerSchema} from './schemas/container-schema';

export class FluidFormInitialize {
    public static CONTAINER_ID: string = "0000000000000";

    constructor() {
        if (FluidFormInitialize.CONTAINER_ID.length !== 13) {
            throw new Error("Container ID must be 13 characters in length");
        }

        RouterliciousClient.init(
            new ExternalRouterliciousConfig(
                "ExternalRouterlicious",
                "InsecureJWTKey"
            )
        );
    }

    initializeContainer(containerId?: string) {
        if (!containerId) {
            containerId = FluidFormInitialize.CONTAINER_ID;
        }
        console.log("Initializing fluid form container with id", containerId);

        RouterliciousClient.createContainer(
            { id: containerId },
            containerSchema
        )
            .then((container) => {
                console.log("Container:", container);
            })
            .catch((err) => {
                console.error("Error when getting Tinylicous container:", err);
            });
    }
}
