import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {startHeartbeat} from './heartbeat';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startHeartbeat', () => {
  it('sends at once, then every 180 s with the current listening value', async () => {
    let listening = true;
    const send = vi.fn(async (_l: boolean) => {});
    const stop = startHeartbeat(() => listening, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(true);
    listening = false;
    await vi.advanceTimersByTimeAsync(179000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(180000);
    expect(send).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stop ends the loop', async () => {
    const send = vi.fn(async (_l: boolean) => {});
    const stop = startHeartbeat(() => true, send);
    stop();
    await vi.advanceTimersByTimeAsync(600000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a rejected send neither throws nor stops the loop; one warning per failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn(async (_l: boolean) => {
      throw new Error('offline');
    });
    const stop = startHeartbeat(() => true, send, 1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(3);
    stop();
  });

  it('a send that throws synchronously is swallowed too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn((_l: boolean): Promise<void> => {
      throw new Error('boom');
    });
    const stop = startHeartbeat(() => true, send, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    stop();
  });
});
