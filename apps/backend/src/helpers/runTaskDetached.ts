/**
Run a function in a detached thread (without blocking the main thread)
@param fn - The function to run
@param params - The parameters to pass to the function
**/
export const runDetached = <T>(fn: (params: T) => Promise<any>, params: T) => {
    setImmediate(() => {
      fn(params).catch((err) => {
        console?.error?.({ err }, 'Background job failed');
      });
    });
  }