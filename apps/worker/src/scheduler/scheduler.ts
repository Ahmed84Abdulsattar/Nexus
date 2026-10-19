export interface SchedulerLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ScheduledJob {
  /** Stable name, for logs and `trigger`. */
  name: string;
  /** Runs once on start (after the leader check), then every `intervalMs()`. */
  runOnStart: boolean;
  /** Read after every run, so a changed setting applies to the next wait. */
  intervalMs: () => number | Promise<number>;
  run: () => Promise<void>;
  /** Early runs (`requestEarly`) are at least this far apart. Default: none allowed. */
  minEarlyGapMs?: number;
}

export type RunOutcome = 'ran' | 'failed' | 'skipped_overlap' | 'skipped_not_leader';

export interface SchedulerOptions {
  /** Called before EVERY job run. False means another replica leads: the job does not run. */
  ensureLeader: () => Promise<boolean>;
  logger?: SchedulerLogger;
  now?: () => number;
}

interface JobState {
  job: ScheduledJob;
  running: boolean;
  lastStartedAt: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  earlyTimer: ReturnType<typeof setTimeout> | undefined;
}

const quiet: SchedulerLogger = { log() {}, warn() {}, error() {} };

/**
 * A small in-process scheduler (docs/07 section 5). Rules:
 * - A job never overlaps itself: a tick that finds the job still running is skipped.
 * - The leader check runs before every run; a non-leader does nothing and checks again next tick.
 * - A failing job is logged (message only) and the schedule continues.
 * - The next regular run is one interval after the previous run FINISHED, so a slow run never
 *   makes two runs back to back.
 * - An early run (`requestEarly`, for example unknown ids seen by the poll) starts at once when
 *   the job's last run began at least `minEarlyGapMs` ago, otherwise it waits for the rest of that
 *   gap. Any number of requests while one is waiting still make one run.
 */
export class Scheduler {
  private readonly jobs = new Map<string, JobState>();
  private readonly log: SchedulerLogger;
  private readonly now: () => number;
  private started = false;

  constructor(private readonly options: SchedulerOptions) {
    this.log = options.logger ?? quiet;
    this.now = options.now ?? Date.now;
  }

  register(job: ScheduledJob): void {
    if (this.jobs.has(job.name)) throw new Error(`job ${job.name} is already registered`);
    this.jobs.set(job.name, {
      job,
      running: false,
      lastStartedAt: undefined,
      timer: undefined,
      earlyTimer: undefined,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const state of this.jobs.values()) {
      if (state.job.runOnStart) void this.runNow(state.job.name);
      else void this.scheduleNext(state);
    }
  }

  stop(): void {
    this.started = false;
    for (const state of this.jobs.values()) {
      clearTimeout(state.timer);
      clearTimeout(state.earlyTimer);
      state.timer = undefined;
      state.earlyTimer = undefined;
    }
  }

  /** Waits until no job is running (shutdown). */
  async idle(): Promise<void> {
    while ([...this.jobs.values()].some((s) => s.running)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /**
   * Runs the job now (also the body of every scheduled tick). Never throws. Reschedules the next
   * regular run when the scheduler is started.
   */
  async runNow(name: string): Promise<RunOutcome> {
    const state = this.mustGet(name);
    if (state.running) {
      this.log.warn(`${name}: previous run still in progress, skipping this tick`);
      return 'skipped_overlap';
    }
    state.running = true;
    let outcome: RunOutcome;
    try {
      let leader = false;
      try {
        leader = await this.options.ensureLeader();
      } catch (error) {
        this.log.error(`${name}: leader check failed: ${describe(error)}`);
      }
      if (!leader) {
        outcome = 'skipped_not_leader';
      } else {
        state.lastStartedAt = this.now();
        try {
          await state.job.run();
          outcome = 'ran';
        } catch (error) {
          this.log.error(`${name}: run failed: ${describe(error)}`);
          outcome = 'failed';
        }
      }
    } finally {
      state.running = false;
    }
    // A replica that is not the leader looks again soon, so a dead leader is replaced quickly.
    if (this.started)
      await this.scheduleNext(state, outcome === 'skipped_not_leader' ? 60_000 : undefined);
    return outcome;
  }

  /**
   * Asks for a run earlier than the schedule. Returns what happened to the request.
   * `started` = running now; `deferred` = will run when the minimum gap has passed;
   * `already_pending` / `running` / `not_allowed` = nothing new to do.
   */
  requestEarly(
    name: string,
  ): 'started' | 'deferred' | 'already_pending' | 'running' | 'not_allowed' {
    const state = this.mustGet(name);
    const gap = state.job.minEarlyGapMs;
    if (gap === undefined) return 'not_allowed';
    if (state.running) return 'running';
    if (state.earlyTimer) return 'already_pending';
    const waitMs =
      state.lastStartedAt === undefined ? 0 : Math.max(0, state.lastStartedAt + gap - this.now());
    if (waitMs === 0) {
      void this.runNow(name);
      return 'started';
    }
    state.earlyTimer = setTimeout(() => {
      state.earlyTimer = undefined;
      void this.runNow(name);
    }, waitMs);
    return 'deferred';
  }

  private async scheduleNext(state: JobState, capMs?: number): Promise<void> {
    clearTimeout(state.timer);
    let ms: number;
    try {
      ms = await state.job.intervalMs();
    } catch (error) {
      this.log.error(
        `${state.job.name}: cannot read the interval, retrying in 1 minute: ${describe(error)}`,
      );
      ms = 60_000;
    }
    if (!this.started) return;
    state.timer = setTimeout(
      () => void this.runNow(state.job.name),
      Math.max(1_000, capMs === undefined ? ms : Math.min(ms, capMs)),
    );
  }

  private mustGet(name: string): JobState {
    const state = this.jobs.get(name);
    if (!state) throw new Error(`unknown job ${name}`);
    return state;
  }
}

/** Error name and message only. Messages here never carry credentials (the db and DATOMS layers redact). */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
}
