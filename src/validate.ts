import type { BinaryOperator, Expression, SourceSpan, UnaryOperator } from "./ast.js";
import { AXQLError, LimitError, ValidationError } from "./errors.js";
import { getFunctionSpec } from "./functions.js";
import { resolveLimits, type LimitOptions } from "./limits.js";

export interface ValidateOptions extends LimitOptions {}

const BINARY_OPERATORS = new Set<BinaryOperator>(["=", "!=", "<", "<=", ">", ">=", "AND", "OR", "+", "-", "*", "/"]);
const UNARY_OPERATORS = new Set<UnaryOperator>(["NOT", "-"]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface ValidationFrame {
  readonly value: unknown;
  readonly depth: number;
  readonly path: string;
}

export function validate(input: unknown, options: ValidateOptions = {}): asserts input is Expression {
  try {
    validateInternal(input, options);
  } catch (error) {
    if (error instanceof AXQLError) throw error;
    throw new ValidationError("INVALID_AST", "AST validation failed while inspecting an unsafe value", {
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
  }
}

function validateInternal(input: unknown, options: ValidateOptions): void {
  const limits = resolveLimits(options.limits);
  const stack: ValidationFrame[] = [{ value: input, depth: 1, path: "$" }];
  let nodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new LimitError("NODE_LIMIT_EXCEEDED", `AST exceeds the ${limits.maxNodes}-node limit`, {
        phase: "validate",
        details: { limit: limits.maxNodes, actual: nodes, path: frame.path },
      });
    }
    if (frame.depth > limits.maxDepth) {
      throw new LimitError("DEPTH_LIMIT_EXCEEDED", `AST exceeds the depth limit of ${limits.maxDepth}`, {
        phase: "validate",
        details: { limit: limits.maxDepth, actual: frame.depth, path: frame.path },
      });
    }

    const node = requireRecord(frame.value, frame.path);
    const kind = readDataProperty(node, "kind", frame.path);
    if (typeof kind !== "string") invalid(`${frame.path}.kind`, "must be a string");

    switch (kind) {
      case "literal": {
        checkKeys(node, ["kind", "value"], frame.path);
        const value = readDataProperty(node, "value", frame.path);
        if (value !== null && typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") {
          invalid(`${frame.path}.value`, "must be a string, finite number, boolean, or null");
        }
        if (typeof value === "number" && !Number.isFinite(value)) {
          invalid(`${frame.path}.value`, "must be finite");
        }
        break;
      }
      case "identifier": {
        checkKeys(node, ["kind", "path"], frame.path);
        const path = readDenseArray(readDataProperty(node, "path", frame.path), `${frame.path}.path`);
        if (path.length === 0) invalid(`${frame.path}.path`, "must contain at least one segment");
        for (let index = 0; index < path.length; index += 1) {
          const segment = path[index];
          if (typeof segment !== "string" || !IDENTIFIER.test(segment)) {
            invalid(`${frame.path}.path[${index}]`, "must be a valid identifier segment");
          }
        }
        break;
      }
      case "unary": {
        checkKeys(node, ["kind", "op", "argument"], frame.path);
        const operator = readDataProperty(node, "op", frame.path);
        if (typeof operator !== "string" || !UNARY_OPERATORS.has(operator as UnaryOperator)) {
          throw new ValidationError("UNKNOWN_OPERATOR", `Unknown unary operator ${JSON.stringify(operator)}`, {
            details: { operator, path: `${frame.path}.op` },
          });
        }
        stack.push({ value: readDataProperty(node, "argument", frame.path), depth: frame.depth + 1, path: `${frame.path}.argument` });
        break;
      }
      case "binary": {
        checkKeys(node, ["kind", "op", "left", "right"], frame.path);
        const operator = readDataProperty(node, "op", frame.path);
        if (typeof operator !== "string" || !BINARY_OPERATORS.has(operator as BinaryOperator)) {
          throw new ValidationError("UNKNOWN_OPERATOR", `Unknown binary operator ${JSON.stringify(operator)}`, {
            details: { operator, path: `${frame.path}.op` },
          });
        }
        stack.push(
          { value: readDataProperty(node, "right", frame.path), depth: frame.depth + 1, path: `${frame.path}.right` },
          { value: readDataProperty(node, "left", frame.path), depth: frame.depth + 1, path: `${frame.path}.left` },
        );
        break;
      }
      case "array": {
        checkKeys(node, ["kind", "elements"], frame.path);
        const elements = readDenseArray(readDataProperty(node, "elements", frame.path), `${frame.path}.elements`);
        for (let index = elements.length - 1; index >= 0; index -= 1) {
          stack.push({ value: elements[index], depth: frame.depth + 1, path: `${frame.path}.elements[${index}]` });
        }
        break;
      }
      case "call": {
        checkKeys(node, ["kind", "name", "arguments"], frame.path);
        const name = readDataProperty(node, "name", frame.path);
        if (typeof name !== "string") invalid(`${frame.path}.name`, "must be a string");
        const spec = getFunctionSpec(name as string);
        if (spec === undefined) {
          throw new ValidationError("UNKNOWN_FUNCTION", `Unknown function ${JSON.stringify(name)}`, {
            details: { function: name, path: `${frame.path}.name` },
          });
        }
        const args = readDenseArray(readDataProperty(node, "arguments", frame.path), `${frame.path}.arguments`);
        if (args.length !== spec.arity) {
          throw new ValidationError("INVALID_ARITY", `${String(name)} expects ${spec.arity} arguments, received ${args.length}`, {
            details: { function: name, expected: spec.arity, actual: args.length, path: `${frame.path}.arguments` },
          });
        }
        for (let index = args.length - 1; index >= 0; index -= 1) {
          stack.push({ value: args[index], depth: frame.depth + 1, path: `${frame.path}.arguments[${index}]` });
        }
        break;
      }
      default:
        invalid(`${frame.path}.kind`, `contains unknown node kind ${JSON.stringify(kind)}`);
    }
  }
}

function requireRecord(value: unknown, path: string): Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path, "must be an AST node object");
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) invalid(path, "must be a plain object");
  return value as Record<PropertyKey, unknown>;
}

function readDataProperty(record: Record<PropertyKey, unknown>, key: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) invalid(`${path}.${key}`, "is required");
  if (!("value" in descriptor)) invalid(`${path}.${key}`, "must be a data property");
  return descriptor.value;
}

function checkKeys(record: Record<PropertyKey, unknown>, required: readonly string[], path: string): void {
  const allowed = new Set([...required, "loc"]);
  const keys = Reflect.ownKeys(record);
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.has(key)) invalid(path, `contains unexpected property ${String(key)}`);
  }
  for (const key of required) readDataProperty(record, key, path);
  if (keys.includes("loc")) validateLocation(readDataProperty(record, "loc", path), `${path}.loc`);
}

function validateLocation(value: unknown, path: string): asserts value is SourceSpan {
  const span = requireRecord(value, path);
  checkExactKeys(span, ["start", "end"], path);
  for (const name of ["start", "end"] as const) {
    const positionPath = `${path}.${name}`;
    const position = requireRecord(readDataProperty(span, name, path), positionPath);
    checkExactKeys(position, ["offset", "line", "column"], positionPath);
    for (const field of ["offset", "line", "column"] as const) {
      const number = readDataProperty(position, field, positionPath);
      const minimum = field === "offset" ? 0 : 1;
      if (!Number.isSafeInteger(number) || (number as number) < minimum) invalid(`${positionPath}.${field}`, "is invalid");
    }
  }
}

function checkExactKeys(record: Record<PropertyKey, unknown>, expected: readonly string[], path: string): void {
  const keys = Reflect.ownKeys(record);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) {
    invalid(path, `must contain exactly ${expected.join(", ")}`);
  }
  for (const key of expected) readDataProperty(record, key, path);
}

function readDenseArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
      invalid(path, `contains unexpected property ${String(key)}`);
    }
  }
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) invalid(`${path}[${index}]`, "must be a present data element");
    result.push(descriptor.value);
  }
  return result;
}

function invalid(path: string, reason: string): never {
  throw new ValidationError("INVALID_AST", `Invalid AST at ${path}: ${reason}`, { details: { path, reason } });
}
