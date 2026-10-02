import { apiHandler } from '@/lambda-api';
import { workerHandler } from '@/lambda-worker';

/**
 * One image, two functions: the function's `LAMBDA_ROLE` env var picks the
 * handler. The API role serves API Gateway; the worker role is invoked on a
 * schedule and drains the durable job queues. Dispatching in code (instead
 * of two image tags with different CMDs) keeps one image to build, push,
 * and update.
 */
export const handler = async (
  event: unknown,
  context: unknown,
): Promise<unknown> => {
  if (process.env.LAMBDA_ROLE === 'worker') {
    return workerHandler();
  }
  return apiHandler(event, context);
};
