/**
 * Concurrency-Limiting Executor — limits concurrent scans to prevent
 * resource saturation when multiple files change simultaneously.
 *
 * Inspired by CodeScene's ConcurrencyLimitingExecutor pattern:
 *   src/concurrency-limiting-executor.ts
 *
 * This wraps ailinter scan operations in a queue-based executor
 * with a configurable max concurrency (default: 2).
 */

/**
 * A queue-based executor that limits the number of concurrently
 * running async operations.
 *
 * Usage:
 *   const executor = new ConcurrencyLimitingExecutor(2);
 *   const result = await executor.execute(() => scanAndCache(path, binary));
 */
export class ConcurrencyLimitingExecutor {
  private running = 0;
  private queue: Array<() => void> = [];

  /**
   * @param maxConcurrent Maximum number of operations to run in parallel.
   *                      Defaults to 2 — enough for dual-file comparison without
   *                      saturating the user's CPU.
   */
  constructor(private maxConcurrent: number = 2) {}

  /**
   * Execute an async function with concurrency limiting.
   * If the max concurrency is reached, the function is queued
   * until a slot becomes available.
   *
   * @param fn The async function to execute
   * @returns The result of the function
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        this.running++;
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          this.running--;
          this.processQueue();
        }
      };

      if (this.running < this.maxConcurrent) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }

  /**
   * Get the number of currently executing operations.
   */
  get runningCount(): number {
    return this.running;
  }

  /**
   * Get the number of queued (waiting) operations.
   */
  get queuedCount(): number {
    return this.queue.length;
  }

  /**
   * Process the next item in the queue if capacity is available.
   */
  private processQueue(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift()!;
      next();
    }
  }

  /**
   * Clear all pending queue items without executing them.
   */
  clearQueue(): void {
    this.queue = [];
  }
}

/**
 * Global singleton executor for ailinter scan operations.
 * Limits concurrent binary invocations to 2 to avoid
 * saturating system resources during bulk operations.
 */
export const scanExecutor = new ConcurrencyLimitingExecutor(2);
