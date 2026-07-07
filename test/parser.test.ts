import { describe, expect, test } from "bun:test";
import { LimitError, ParseError, parse } from "../src/index.js";

describe("parse", () => {
  test("produces the canonical AST from the primary example", () => {
    expect(parse('amount > 1000 AND currency = "EUR"')).toEqual({
      kind: "binary",
      op: "AND",
      left: {
        kind: "binary",
        op: ">",
        left: { kind: "identifier", path: ["amount"] },
        right: { kind: "literal", value: 1000 },
      },
      right: {
        kind: "binary",
        op: "=",
        left: { kind: "identifier", path: ["currency"] },
        right: { kind: "literal", value: "EUR" },
      },
    });
  });

  test("parses literals, dotted paths, arrays, and canonical function names", () => {
    expect(parse('in(actor.role, ["draft", true, null, 1.5e2])')).toEqual({
      kind: "call",
      name: "IN",
      arguments: [
        { kind: "identifier", path: ["actor", "role"] },
        {
          kind: "array",
          elements: [
            { kind: "literal", value: "draft" },
            { kind: "literal", value: true },
            { kind: "literal", value: null },
            { kind: "literal", value: 150 },
          ],
        },
      ],
    });
  });

  test("uses conventional precedence and left associativity", () => {
    const ast = parse("1 + 2 * 3 - 4 / 2 = 5 OR false AND NOT true");
    expect(ast).toMatchObject({
      kind: "binary",
      op: "OR",
      left: { kind: "binary", op: "=" },
      right: {
        kind: "binary",
        op: "AND",
        right: { kind: "unary", op: "NOT" },
      },
    });
    expect(parse("10 - 3 - 2")).toMatchObject({
      kind: "binary",
      op: "-",
      left: { kind: "binary", op: "-" },
    });
  });

  test("represents negative source numbers as unary expressions", () => {
    expect(parse("-12")).toEqual({
      kind: "unary",
      op: "-",
      argument: { kind: "literal", value: 12 },
    });
  });

  test("supports JSON string escapes", () => {
    expect(parse('"line\\nquote: \\\" ok"')).toEqual({ kind: "literal", value: 'line\nquote: " ok' });
  });

  test("keeps canonical ASTs location-free by default", () => {
    const ast = parse("amount > 0");
    expect("loc" in ast).toBe(false);
    expect("loc" in (ast.kind === "binary" ? ast.left : ast)).toBe(false);
  });

  test("returns a recursively located AST in debug mode", () => {
    const ast = parse("amount > 0", { locations: true });
    expect(ast.loc).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 10, line: 1, column: 11 },
    });
    expect(ast.kind).toBe("binary");
    if (ast.kind === "binary") {
      expect(ast.left.loc.start.offset).toBe(0);
      expect(ast.right.loc.start.offset).toBe(9);
    }
  });

  test.each(["", "1 2", "(1 + 2", "[1,]", "IF(, 1, 2)", "a < b < c"])('rejects invalid syntax: %s', (source) => {
    expect(() => parse(source)).toThrow(ParseError);
  });

  test.each(["01", "1.", "1e", "1e9999"])('rejects invalid number: %s', (source) => {
    expect(() => parse(source)).toThrow(ParseError);
  });

  test("enforces parse node and nesting limits", () => {
    expect(() => parse("1 + 2", { limits: { maxNodes: 2 } })).toThrow(LimitError);
    expect(() => parse("(((1)))", { limits: { maxDepth: 2 } })).toThrow(LimitError);
  });
});
