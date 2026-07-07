# AXQL Core

AXQL Core is a small, deterministic expression engine for formulas, filters, computed fields, reports, and permission gates. It has no runtime dependencies and uses only standard ECMAScript APIs, so it can be embedded in Cloudflare Workers and other JavaScript hosts.

```ts
import { evaluate, parse, validate } from "@axiomorix/axql-core";

const ast = parse('amount > 1000 AND currency = "EUR"');
validate(ast);

const result = evaluate(ast, {
  amount: 1200,
  currency: "EUR",
});
```

The v0 expression profile supports JSON-like literals, dotted identifiers, arrays, arithmetic, comparisons, strict boolean operators, parentheses, and the closed `IF`, `IN`, and `SUM` function set. Operations never coerce values or use JavaScript truthiness.

## Limits

Parsing, validation, and evaluation default to 500 AST nodes, a depth of 32, and 10,000 evaluation steps. Override these per operation through `{ limits: { ... } }`.

Use `parse(source, { locations: true })` when debugging source positions. Ordinary `parse(source)` returns the canonical, location-free JSON AST.
