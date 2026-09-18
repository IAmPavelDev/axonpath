import { oc } from '@orpc/contract';
import * as schema from '../schema/auth.schema.js';

const BASE_PATH = '/auth';

const me = oc
  .route({
    method: 'GET',
    path: `${BASE_PATH}/me`,
    summary: 'Get the authenticated user profile',
    tags: ['Auth', 'Get'],
  })
  .output(schema.MeOutput);

export const authContract = {
  me,
}

export type AuthContractType = typeof authContract;
