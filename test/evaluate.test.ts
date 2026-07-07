import { describe, expect, test } from "bun:test";
import {
  EvaluationError,
  LimitError,
  evaluate,
  parse,
  type EvaluationContext,
} from "../src/index.js";

function run(source: string, context: EvaluationContext = {}): unknown {
  return evaluate(parse(source), context);
}

describe("evaluate", () => {
  test("evaluates the documented expressions", () => {
    const context = {
      amount: 1200,
      currency: "EUR",
      status: "pending",
      actor: { role: "finance_manager" },
    };
    expect(run("amount > 0", context)).toBe(true);
    expect(run('status = "approved"', context)).toBe(false);
    expect(run('amount > 1000 AND currency = "EUR"', context)).toBe(true);
    expect(run('actor.role = "founder" OR actor.role = "finance_manager"', context)).toBe(true);
    expect(run('IN(status, ["draft", "pending", "approved"])', context)).toBe(true);
    expect(run('IF(amount > 1000, "review", "normal")', context)).toBe("review");
  });

  test("evaluates arithmetic, strict equality, and string concatenation", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run('"AX" + "QL"')).toBe("AXQL");
    expect(run('1 = "1"')).toBe(false);
    expect(run("null = null")).toBe(true);
    expect(run("-2 * 3")).toBe(-6);
  });

  test("has no truthiness or mixed coercion", () => {
    expect(() => run("1 AND true")).toThrow(EvaluationError);
    expect(() => run('1 + "2"')).toThrow(EvaluationError);
    expect(() => run('"a" < "b"')).toThrow(EvaluationError);
    expect(() => run("[1] = [1]")).toThrow(EvaluationError);
    expect(() => run("IF(1, 2, 3)")).toThrow(EvaluationError);
  });

  test("short-circuits boolean operators and IF", () => {
    expect(run("false AND (1 / 0 > 0)")).toBe(false);
    expect(run("true OR (1 / 0 > 0)")).toBe(true);
    expect(run("IF(true, 42, 1 / 0)")).toBe(42);
  });

  test("implements IN and SUM with strict element rules", () => {
    expect(run("IN(2, [1, 2, 3])")).toBe(true);
    expect(run('IN(2, ["2"])')).toBe(false);
    expect(run("SUM([1, 2, 3.5])")).toBe(6.5);
    expect(() => run('SUM([1, "2"])')).toThrow(EvaluationError);
    expect(() => run("IN(1, [[1]])")).toThrow(EvaluationError);
  });

  test("resolves absent own properties to null without reading prototypes", () => {
    expect(run("missing = null", {})).toBe(true);
    expect(run("toString = null", {})).toBe(true);
    expect(() => run("present.child", { present: null })).toThrow(EvaluationError);
  });

  test("supports plain and null-prototype context objects", () => {
    const actor = Object.create(null) as Record<string, unknown>;
    actor.role = "founder";
    const context = Object.create(null) as Record<string, unknown>;
    context.actor = actor;
    expect(run('actor.role = "founder"', context)).toBe(true);
  });

  test("rejects accessors and non-plain containers without invoking getters", () => {
    let invoked = false;
    const context: Record<string, unknown> = {};
    Object.defineProperty(context, "secret", {
      enumerable: true,
      get() {
        invoked = true;
        return 42;
      },
    });
    expect(() => run("secret", context)).toThrow(EvaluationError);
    expect(invoked).toBe(false);
    expect(() => run("value", new (class Context { value = 1; })() as unknown as EvaluationContext)).toThrow(EvaluationError);
  });

  test("copies and freezes context arrays without mutation", () => {
    const original = [1, [2, 3]];
    const context = { values: original };
    const result = run("values", context);
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as readonly unknown[])[1])).toBe(true);
    expect(original).toEqual([1, [2, 3]]);
  });

  test("rejects invalid numeric and arithmetic results", () => {
    expect(() => run("1 / 0")).toThrow(EvaluationError);
    expect(() => run("huge * huge", { huge: Number.MAX_VALUE })).toThrow(EvaluationError);
    expect(() => run("bad", { bad: Number.POSITIVE_INFINITY })).toThrow(EvaluationError);
  });

  test("enforces step limits across context arrays and function scans", () => {
    const ast = parse("IN(99, values)");
    expect(() => evaluate(ast, { values: Array.from({ length: 20 }, (_, index) => index) }, { limits: { maxSteps: 15 } })).toThrow(
      LimitError,
    );
  });

  test("is deterministic and does not mutate its inputs", () => {
    const ast = parse("SUM(values) + offset");
    const context = { values: [1, 2, 3], offset: 4 };
    const astSnapshot = JSON.stringify(ast);
    const contextSnapshot = JSON.stringify(context);
    expect(evaluate(ast, context)).toBe(10);
    expect(evaluate(ast, context)).toBe(10);
    expect(JSON.stringify(ast)).toBe(astSnapshot);
    expect(JSON.stringify(context)).toBe(contextSnapshot);
  });
});
