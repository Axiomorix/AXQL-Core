import { expect, test } from "bun:test";
import { evaluate, parse, validate } from "../dist/index.js";

test("published ESM entry point works", () => {
  const ast = parse('amount > 1000 AND currency = "EUR"');
  validate(ast);
  expect(evaluate(ast, { amount: 1200, currency: "EUR" })).toBe(true);
});
