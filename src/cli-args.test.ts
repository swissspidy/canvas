import { describe, expect, it } from "vitest";
import { bool, list, num, parseArgs, positiveInt, str } from "./cli-args.js";

describe("parseArgs", () => {
  it("reads flags as --key value, --key=value and bare switches", () => {
    const args = parseArgs(["run", "--repeats", "3", "--out=runs/x", "--force"]);
    expect(args.command).toBe("run");
    expect(args.flags).toEqual({ repeats: "3", out: "runs/x", force: true });
  });

  it("gives a bare switch the positional that follows it", () => {
    // Long-standing behaviour, pinned rather than endorsed: anything not
    // starting with `--` is taken as the preceding flag's value, so a switch
    // written before a positional swallows it. Every command in `cli.ts` either
    // puts its positional first (`show <taskId>`) or uses no positional at all,
    // so nothing hits this today — but a new command that does would.
    const args = parseArgs(["show", "--force", "fit.long-headline"]);
    expect(args.flags["force"]).toBe("fit.long-headline");
    expect(args.positional).toEqual([]);

    // Written the other way round, which is how the commands are documented,
    // both land where they should.
    const ordered = parseArgs(["show", "fit.long-headline", "--force"]);
    expect(ordered.positional).toEqual(["fit.long-headline"]);
    expect(ordered.flags["force"]).toBe(true);
  });

  it("does not swallow the next flag as a value", () => {
    const args = parseArgs(["run", "--dry-run", "--repeats", "2"]);
    expect(args.flags["dry-run"]).toBe(true);
    expect(args.flags["repeats"]).toBe("2");
  });

  it("falls back to help with no arguments", () => {
    expect(parseArgs([]).command).toBe("help");
  });
});

/**
 * The distinction these two draw is the point of the file: a count that decides
 * how many runs happen is not the same kind of thing as a magnitude, and
 * neither should quietly become its default because somebody mistyped it.
 */
describe("num", () => {
  it("takes any finite number, including zero and negatives", () => {
    expect(num({ effect: "10" }, "effect", 1)).toBe(10);
    expect(num({ effect: "0" }, "effect", 1)).toBe(0);
    expect(num({ effect: "-7.5" }, "effect", 1)).toBe(-7.5);
  });

  it("falls back only when the flag is absent", () => {
    expect(num({}, "effect", 12)).toBe(12);
  });

  it("refuses a value it cannot read rather than using the default", () => {
    // The failure worth avoiding: `--effect abc` silently planting 10 points
    // would answer a different question than the one asked, and say nothing.
    expect(() => num({ effect: "abc" }, "effect", 10)).toThrow(/must be a number.*'abc'/);
    expect(() => num({ effect: "" }, "effect", 10)).toThrow(/must be a number/);
  });

  it("refuses a flag given without a value", () => {
    expect(() => num({ effect: true }, "effect", 10)).toThrow(/needs a value/);
  });
});

describe("positiveInt", () => {
  it("takes whole numbers of at least one", () => {
    expect(positiveInt({ repeats: "3" }, "repeats", 1)).toBe(3);
    expect(positiveInt({ repeats: "1" }, "repeats", 9)).toBe(1);
    expect(positiveInt({}, "repeats", 3)).toBe(3);
  });

  it("refuses the values that break a count downstream", () => {
    // `--trials 0` divided by zero and printed every rate as NaN; `--tasks 1.5`
    // ran two tasks and labelled the output 1.5; a negative count produced an
    // empty simulation indistinguishable from a finished one.
    expect(() => positiveInt({ trials: "0" }, "trials", 400)).toThrow(/whole number of at least 1.*'0'/);
    expect(() => positiveInt({ tasks: "1.5" }, "tasks", 23)).toThrow(/whole number of at least 1.*'1\.5'/);
    expect(() => positiveInt({ repeats: "-2" }, "repeats", 3)).toThrow(/whole number of at least 1/);
    expect(() => positiveInt({ concurrency: "abc" }, "concurrency", 4)).toThrow(/whole number of at least 1/);
    expect(() => positiveInt({ n: "Infinity" }, "n", 40)).toThrow(/whole number of at least 1/);
  });

  it("names the flag the way it was typed, so the message is actionable", () => {
    expect(() => positiveInt({ "max-tokens": "0" }, "max-tokens", 16000)).toThrow(/^--max-tokens /);
  });
});

describe("str, bool and list", () => {
  it("reads a string flag or falls back", () => {
    expect(str({ method: "permutation" }, "method", "bootstrap")).toBe("permutation");
    expect(str({}, "method", "bootstrap")).toBe("bootstrap");
    // A bare `--method` carries no string, so the default stands.
    expect(str({ method: true }, "method", "bootstrap")).toBe("bootstrap");
  });

  it("treats a bare switch as on and an explicit 'false' as off", () => {
    expect(bool({ judge: true }, "judge", false)).toBe(true);
    expect(bool({ judge: "false" }, "judge", true)).toBe(false);
    expect(bool({}, "judge", true)).toBe(true);
  });

  it("splits a comma list and drops the gaps", () => {
    expect(list({ surfaces: "coordinate, relational ,," }, "surfaces", [])).toEqual([
      "coordinate",
      "relational",
    ]);
    expect(list({}, "surfaces", ["document"])).toEqual(["document"]);
  });
});
