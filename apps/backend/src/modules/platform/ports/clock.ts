export interface Clock {
  now(): Date;
}

export const makeSystemClock = (): Clock => ({
  now: () => new Date(),
});
