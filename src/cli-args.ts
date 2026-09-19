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
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2);
      if (inline !== undefined) flags[key!] = inline;
      else if (rest[i + 1] && !rest[i + 1]!.startsWith("--")) flags[key!] = rest[++i]!;
      else flags[key!] = true;
    } else {
      positional.push(arg);
    }
  }
  return { command, flags, positional };
}

export const str = (flags: Args["flags"], key: string, fallback: string): string =>
  typeof flags[key] === "string" ? (flags[key] as string) : fallback;

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
  key in flags ? flags[key] !== "false" : fallback;

export const list = (flags: Args["flags"], key: string, fallback: string[]): string[] => {
  const raw = flags[key];
  if (typeof raw !== "string") return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
};
