/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import {Container, Loader} from '@fluidframework/container-loader';
import {DOProviderContainerRuntimeFactory, FluidContainer} from '@fluid-experimental/fluid-static';
import {IRouterliciousConfig, RouterliciousService} from '@fluid-experimental/get-container'; // deprecated
import {ContainerSchema} from '@fluid-experimental/fluid-static/src/types';
import {IDocumentServiceFactory, IUrlResolver} from '@fluidframework/driver-definitions';
import {RouterliciousDocumentServiceFactory} from '@fluidframework/routerlicious-driver';
import {InsecureTokenProvider} from '@fluidframework/test-runtime-utils';
import {IRuntimeFactory} from '@fluidframework/container-definitions';
import {RouterliciousContainerConfig} from './interfaces';

class LocalhostRouterliciousConfig implements IRouterliciousConfig {
  constructor(public tenantId: string, public key: string, public orderer: string = 'http://localhost:3003', public storage: string = 'http://localhost:3001') {}
}

export class ExternalRouterliciousConfig implements IRouterliciousConfig{
  constructor(public tenantId: string, public key: string, public orderer: string = 'http://86.119.42.105:3003', public storage: string = 'http://86.119.42.105:3001') {}
}

/**
 * RouterliciousClientInstance provides the ability to have a Fluid object backed by a Routerlicious service
 */
export class RouterliciousClientInstance {
  public readonly documentServiceFactory: IDocumentServiceFactory;
  public readonly urlResolver: IUrlResolver;

  constructor(config?: IRouterliciousConfig) {
    config = config ?? new LocalhostRouterliciousConfig('LocalhostRouterlicious', 'InsecureAbrakadabraJWT');
    let routerliciousService = new RouterliciousService(config);
    const user = {
      id: 'unique-id',
      name: 'Dennis Platz'
    };
    const tokenProvider = new InsecureTokenProvider(config.key, user);
    this.urlResolver = routerliciousService.urlResolver;
    this.documentServiceFactory = new RouterliciousDocumentServiceFactory(tokenProvider);
  }

  public async createContainer(serviceContainerConfig: RouterliciousContainerConfig, containerSchema: ContainerSchema): Promise<FluidContainer> {
    const runtimeFactory = new DOProviderContainerRuntimeFactory(containerSchema);
    const container = await this.getContainerCore(serviceContainerConfig.id, runtimeFactory, true);
    return this.getRootDataObject(container);
  }

  public async getContainer(serviceContainerConfig: RouterliciousContainerConfig, containerSchema: ContainerSchema): Promise<FluidContainer> {
    const runtimeFactory = new DOProviderContainerRuntimeFactory(containerSchema);
    const container = await this.getContainerCore(serviceContainerConfig.id, runtimeFactory, false);
    return this.getRootDataObject(container);
  }

  private async getRootDataObject(container: Container): Promise<FluidContainer> {
    const rootDataObject = (await container.request({url: '/'})).value;
    return rootDataObject as FluidContainer;
  }

  private async getContainerCore(containerId: string, containerRuntimeFactory: IRuntimeFactory, createNew: boolean): Promise<Container> {
    const module = {fluidExport: containerRuntimeFactory};
    const codeLoader = {load: async () => module};

    const loader = new Loader({
      urlResolver: this.urlResolver,
      documentServiceFactory: this.documentServiceFactory,
      codeLoader
    });

    let container: Container;

    if (createNew) {
      // We're not actually using the code proposal (our code loader always loads the same module
      // regardless of the proposal), but the Container will only give us a NullRuntime if there's
      // no proposal.  So we'll use a fake proposal.
      container = await loader.createDetachedContainer({
        package: 'no-dynamic-package',
        config: {}
      });
      await container.attach({url: containerId});
    } else {
      // Request must be appropriate and parseable by resolver.
      container = await loader.resolve({url: containerId});
      // If we didn't create the container properly, then it won't function correctly.  So we'll throw if we got a
      // new container here, where we expect this to be loading an existing container.
      if (container.existing === undefined) {
        throw new Error('Attempted to load a non-existing container');
      }
    }
    return container;
  }
}

/**
 * Singular global instance that lets the developer define all Container interactions with the Routerlicious service
 */
let globalRouterliciousClient: RouterliciousClientInstance | undefined;
export const RouterliciousClient = {
  init(config?: IRouterliciousConfig) {
    if (globalRouterliciousClient) {
      throw new Error('RouterliciousClient cannot be initialized more than once');
    }
    globalRouterliciousClient = new RouterliciousClientInstance(config);
  },
  async createContainer(serviceConfig: RouterliciousContainerConfig, objectConfig: ContainerSchema): Promise<FluidContainer> {
    if (!globalRouterliciousClient) {
      throw new Error('RouterliciousClient has not been properly initialized before attempting to create a container');
    }
    return globalRouterliciousClient.createContainer(serviceConfig, objectConfig);
  },
  async getContainer(serviceConfig: RouterliciousContainerConfig, objectConfig: ContainerSchema): Promise<FluidContainer> {
    if (!globalRouterliciousClient) {
      throw new Error('RouterliciousClient has not been properly initialized before attempting to get a container');
    }
    return globalRouterliciousClient.getContainer(serviceConfig, objectConfig);
  }
};
