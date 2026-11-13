/**
 * Command-line argument parsing and coercion.
 *
 * Split out of `cli.ts` because that module runs `main()` on import, so nothing
 * in it can be reached from a test without running the CLI. These coercions
 * decide how many runs a sweep makes and what it costs, which is worth pinning
 * down directly rather than by spawning a process and reading stdout.
 *
 * The rule they share: a flag that is absent falls back, and a flag that is
 * present but unusable is an error. Silently falling back on a value somebody
 * typed is the failure worth avoiding here — `--repeats abc` quietly running
 * the default is a sweep that costs what it costs and answers a different
 * question than the one asked for.
 */

export interface Args {
  command: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

export function parseArgs(argv: string[]): Args {
  // `--help` anywhere means help, whatever command it follows. Treated as a
  // flag, `run --help` would start the default sweep — the full confirmatory
  // grid, against a live API — which is the worst possible reading of it.
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    return { command: "help", flags: {}, positional: [] };
  }
  const [command = "help", ...rest] = argv;
  // No prototype: a flag is looked up by a name the user typed, and on a plain
  // object `--toString` is already "set".
  const flags: Record<string, string | boolean> = Object.create(null);
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      // Split on the first `=` only: `--out=runs/a=b` names `runs/a=b`, and
      // `split("=", 2)` threw the rest away and wrote the sweep to `runs/a`.
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      const key = eq === -1 ? body : body.slice(0, eq);
      const inline = eq === -1 ? undefined : body.slice(eq + 1);
      if (inline !== undefined) flags[key!] = inline;
      else if (rest[i + 1] && !rest[i + 1]!.startsWith("--")) flags[key!] = rest[++i]!;
      else flags[key!] = true;
    } else {
      positional.push(arg);
    }
  }
  return { command, flags, positional };
}

/**
 * A flag given with nothing after it. Falling back to the default there read
 * `--tasks --models x` as "every task", silently, on a command that spends
 * money per cell.
 */
function requireValue(flags: Args["flags"], key: string): void {
  if (flags[key] === true || flags[key] === "") throw new Error(`--${key} needs a value.`);
}

export const str = (flags: Args["flags"], key: string, fallback: string): string => {
  requireValue(flags, key);
  return typeof flags[key] === "string" ? (flags[key] as string) : fallback;
};

/** Every flag some command reads. */
export const KNOWN_FLAGS = [
  "base", "by", "concurrency", "dir", "dry-run", "effect", "effort", "estimate", "feedback", "force", "from", "judge-model",
  "max-tokens", "method", "models", "n", "no-judge", "out", "pairs", "passing", "ratings", "repeats", "run-sd", "surfaces",
  "task-sd", "tasks", "trials", "turn-budget", "width",
] as const;

/**
 * Refuse a flag no command reads. An unknown flag used to be ignored, so
 * `--dryrun` started a paid sweep and `--model x` ran the default model.
 */
export function assertKnownFlags(flags: Args["flags"]): void {
  const known = new Set<string>(KNOWN_FLAGS);
  for (const key of Object.keys(flags)) {
    if (known.has(key)) continue;
    const squash = (v: string) => v.replace(/-/g, "");
    const near = KNOWN_FLAGS.find((k) => squash(k) === squash(key) || k === `${key}s` || `${k}s` === key || k.startsWith(key));
    throw new Error(`Unknown option --${key}.${near ? ` Did you mean --${near}?` : ""} Run with --help for the list.`);
  }
}

/**
 * A real-valued setting: any finite number, including zero and negatives.
 *
 * Used for thresholds and magnitudes — an effect size to plant, a standard
 * deviation, a point on the scale. A planted effect of zero is how calibration
 * gets measured, so this deliberately does not insist on a positive value.
 */
export const num = (flags: Args["flags"], key: string, fallback: number): number => {
  const raw = flags[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "string") {
    throw new Error(`--${key} needs a value.`);
  }
  const parsed = raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${key} must be a number. Got '${raw}'.`);
  }
  return parsed;
};

/**
 * A count: a whole number of at least one.
 *
 * Dimensions rather than magnitudes — tasks, repeats, trials, workers, a
 * sample size, a pixel width. `num` would accept values that make no sense as
 * a count and fail somewhere further along instead: `--trials 0` divides by
 * zero and reports every rate as NaN, `--tasks 1.5` runs two tasks while
 * labelling the output 1.5, and a negative count produces an empty run that
 * looks like a finished one.
 */
export const positiveInt = (flags: Args["flags"], key: string, fallback: number): number => {
  const raw = flags[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "string") {
    throw new Error(`--${key} needs a value.`);
  }
  const parsed = raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${key} must be a whole number of at least 1. Got '${raw}'.`);
  }
  return parsed;
};

export const bool = (flags: Args["flags"], key: string, fallback = false): boolean =>
  flags[key] !== undefined ? flags[key] !== "false" : fallback;

export const list = (flags: Args["flags"], key: string, fallback: string[]): string[] => {
  requireValue(flags, key);
  const raw = flags[key];
  if (typeof raw !== "string") return fallback;
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  // `--surfaces=,` is not "no surfaces": a sweep over nothing ran to "Done".
  if (items.length === 0) throw new Error(`--${key} needs at least one value.`);
  return items;
};
