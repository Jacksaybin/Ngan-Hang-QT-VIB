jest.useFakeTimers();

const { enqueue, setMaxPerSec, reset } = require('../lib/telegram-queue');

describe('telegram-queue throttling', () => {
  afterEach(() => {
    reset();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('limits number of executions per second', async () => {
    // set 2 sends per second => interval 500ms
    setMaxPerSec(2);

    const calls = [];
    // create 5 tasks that resolve immediately
    const tasks = Array.from({ length: 5 }).map((_, i) => () => {
      calls.push(i);
      return Promise.resolve(i);
    });

    const promises = tasks.map((fn) => enqueue(fn));

    // advance enough time to process all (5 tasks * 500ms = 2500ms)
    jest.advanceTimersByTime(2500);
    // allow microtasks to run
    await Promise.resolve();

    expect(calls.length).toBe(5);

    const results = await Promise.all(promises);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });
});
