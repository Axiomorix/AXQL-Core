import { describe, expect, test } from "bun:test";
import {
  LimitError,
  ValidationError,
  parse,
  validate,
  type Expression,
} from "../src/index.js";

describe("validate", () => {
  test("accepts canonical and located parser output", () => {
    expect(() => validate(parse("IF(amount > 0, amount, 0)"))).not.toThrow();
    expect(() => validate(parse("amount > 0", { locations: true }))).not.toThrow();
  });

  test("accepts finite negative literals from deserialized ASTs", () => {
    expect(() => validate({ kind: "literal", value: -2 })).not.toThrow();
  });

  test.each([
    [{ kind: "literal", value: Number.NaN }],
    [{ kind: "literal", value: 1, extra: true }],
    [{ kind: "identifier", path: [] }],
    [{ kind: "identifier", path: ["not-valid!"] }],
    [{ kind: "binary", op: "%", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 2 } }],
    [{ kind: "call", name: "MISSING", arguments: [] }],
    [{ kind: "call", name: "constructor", arguments: [] }],
    [{ kind: "call", name: "__proto__", arguments: [] }],
    [{ kind: "call", name: "IF", arguments: [{ kind: "literal", value: true }] }],
    [{ version: 1, profile: "expression", ast: { kind: "literal", value: 1 } }],
  ])("rejects malformed or non-core AST input", (ast) => {
    expect(() => validate(ast)).toThrow(ValidationError);
  });

  test("does not invoke accessors while validating", () => {
    let invoked = false;
    const ast = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(ast, "kind", {
      enumerable: true,
      get() {
        invoked = true;
        return "literal";
      },
    });
    Object.defineProperty(ast, "value", { enumerable: true, value: 1 });
    expect(() => validate(ast)).toThrow(ValidationError);
    expect(invoked).toBe(false);
  });

  test("enforces exact node and depth boundaries", () => {
    const ast = parse("1 + 2");
    expect(() => validate(ast, { limits: { maxNodes: 3, maxDepth: 2 } })).not.toThrow();
    expect(() => validate(ast, { limits: { maxNodes: 2 } })).toThrow(LimitError);
    expect(() => validate(ast, { limits: { maxDepth: 1 } })).toThrow(LimitError);
  });

  test("handles deeply malicious input iteratively", () => {
    let ast: Expression = { kind: "literal", value: true };
    for (let index = 0; index < 200; index += 1) ast = { kind: "unary", op: "NOT", argument: ast };
    expect(() => validate(ast, { limits: { maxDepth: 32, maxNodes: 500 } })).toThrow(LimitError);
  });
});
