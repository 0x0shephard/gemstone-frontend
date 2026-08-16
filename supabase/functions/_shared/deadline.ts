/**
 * A ceiling on how long a scheduled function will take to answer.
 *
 * The platform kills a worker that overruns, and the caller gets
 * WORKER_RESOURCE_LIMIT and nothing else — no partial result, and no indication
 * of which call hung. That is an expensive way to learn anything: diagnosing one
 * such hang meant repeated blind deploys, and the fix only became obvious once
 * the function reported which phase it had reached.
 *
 * Answering below the platform's limit turns an opaque kill into a report.
 *
 * This is a reporting guard, not a cancellation: the work carries on in the
 * background until the worker is torn down. That is safe for these sweeps
 * because each commits its cursor as it goes, so anything the abandoned run
 * completed is kept and anything it did not is retried. Do not reach for this
 * where an unfinished operation would leave inconsistent state.
 */

/** Distinct from any legitimate result, so a caller cannot confuse the two. */
export const TIMED_OUT = Symbol('deadline.timed-out');

/**
 * Records how far a piece of work got, in milliseconds from its start.
 *
 * Passed in by the caller rather than returned, so the marks survive the work
 * being abandoned — which is the whole point. The phase after the last one
 * recorded is the one that hung.
 */
export interface PhaseLog {
  marks: Record<string, number>;
  mark: (phase: string) => void;
  elapsed: () => number;
}

export function phaseLog(): PhaseLog {
  const startedAt = Date.now();
  const marks: Record<string, number> = {};
  return {
    marks,
    mark: (phase) => {
      marks[phase] = Date.now() - startedAt;
    },
    elapsed: () => Date.now() - startedAt,
  };
}

/** Runs `work`, giving up on waiting for it after `ms`. */
export async function withDeadline<T>(
  ms: number,
  work: () => Promise<T>,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    // Otherwise a pending timer holds the isolate open after a fast run.
    if (timer !== undefined) clearTimeout(timer);
  }
}
