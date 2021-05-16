import {ContainerSchema} from '@fluid-experimental/fluid-static/dist/types';
import { CollaborativeText } from '..';

export const containerSchema: ContainerSchema = {
    name: 'CollaborativeTextContainer',
    initialObjects: {
      collaborativeText: CollaborativeText // container needs to have a root data object, which is FluidFormRootDataObject in our case.
    },
    dynamicObjectTypes: [] // would allow us to create n different Form-Objects inside 1 container (instead of nested in FluidFormRootDataObject)
  };
