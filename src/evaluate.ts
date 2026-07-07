import type { AXQLValue, BinaryOperator, EvaluationContext, Expression, UnaryOperator } from "./ast.js";
import { AXQLError, EvaluationError, LimitError } from "./errors.js";
import { invokeStandardFunction, type StandardFunctionName } from "./functions.js";
import { resolveLimits, type LimitOptions } from "./limits.js";
import { validate } from "./validate.js";

export interface EvaluateOptions extends LimitOptions {}

type Frame =
  | { readonly type: "eval"; readonly node: Expression }
  | { readonly type: "unary"; readonly operator: UnaryOperator }
  | { readonly type: "binaryLeft"; readonly operator: BinaryOperator; readonly right: Expression }
  | { readonly type: "binaryRight"; readonly operator: BinaryOperator; readonly left: AXQLValue }
  | { readonly type: "shortCircuitLeft"; readonly operator: "AND" | "OR"; readonly right: Expression }
  | { readonly type: "shortCircuitRight"; readonly operator: "AND" | "OR" }
  | { readonly type: "arrayElement"; readonly elements: readonly Expression[]; readonly nextIndex: number; readonly values: AXQLValue[] }
  | {
      readonly type: "callArgument";
      readonly name: Exclude<StandardFunctionName, "IF">;
      readonly args: readonly Expression[];
      readonly nextIndex: number;
      readonly values: AXQLValue[];
    }
  | { readonly type: "ifCondition"; readonly whenTrue: Expression; readonly whenFalse: Expression };

export function evaluate(ast: Expression, context: EvaluationContext, options: EvaluateOptions = {}): AXQLValue {
  try {
    const limits = resolveLimits(options.limits);
    validate(ast, { limits });
    requireContextContainer(context, "context");

    let steps = 0;
    const consumeStep = (): void => {
      steps += 1;
      if (steps > limits.maxSteps) {
        throw new LimitError("STEP_LIMIT_EXCEEDED", `Evaluation exceeds the ${limits.maxSteps}-step limit`, {
          phase: "evaluate",
          details: { limit: limits.maxSteps, actual: steps },
        });
      }
    };

    const frames: Frame[] = [{ type: "eval", node: ast }];
    const values: AXQLValue[] = [];

    while (frames.length > 0) {
      const frame = frames.pop();
      if (frame === undefined) break;

      switch (frame.type) {
        case "eval": {
          consumeStep();
          const node = frame.node;
          switch (node.kind) {
            case "literal":
              values.push(node.value);
              break;
            case "identifier":
              values.push(resolveIdentifier(context, node.path, consumeStep));
              break;
            case "unary":
              frames.push({ type: "unary", operator: node.op }, { type: "eval", node: node.argument });
              break;
            case "binary":
              if (node.op === "AND" || node.op === "OR") {
                frames.push({ type: "shortCircuitLeft", operator: node.op, right: node.right }, { type: "eval", node: node.left });
              } else {
                frames.push({ type: "binaryLeft", operator: node.op, right: node.right }, { type: "eval", node: node.left });
              }
              break;
            case "array": {
              if (node.elements.length === 0) {
                values.push(Object.freeze([]) as readonly AXQLValue[]);
              } else {
                frames.push(
                  { type: "arrayElement", elements: node.elements, nextIndex: 1, values: [] },
                  { type: "eval", node: node.elements[0] as Expression },
                );
              }
              break;
            }
            case "call": {
              consumeStep();
              if (node.name === "IF") {
                frames.push(
                  { type: "ifCondition", whenTrue: node.arguments[1] as Expression, whenFalse: node.arguments[2] as Expression },
                  { type: "eval", node: node.arguments[0] as Expression },
                );
              } else {
                frames.push(
                  {
                    type: "callArgument",
                    name: node.name as Exclude<StandardFunctionName, "IF">,
                    args: node.arguments,
                    nextIndex: 1,
                    values: [],
                  },
                  { type: "eval", node: node.arguments[0] as Expression },
                );
              }
              break;
            }
          }
          break;
        }
        case "unary": {
          consumeStep();
          values.push(applyUnary(frame.operator, popValue(values)));
          break;
        }
        case "binaryLeft": {
          const left = popValue(values);
          frames.push({ type: "binaryRight", operator: frame.operator, left }, { type: "eval", node: frame.right });
          break;
        }
        case "binaryRight": {
          consumeStep();
          values.push(applyBinary(frame.operator, frame.left, popValue(values)));
          break;
        }
        case "shortCircuitLeft": {
          consumeStep();
          const left = requireBoolean(popValue(values), frame.operator);
          if ((frame.operator === "AND" && !left) || (frame.operator === "OR" && left)) {
            values.push(left);
          } else {
            frames.push({ type: "shortCircuitRight", operator: frame.operator }, { type: "eval", node: frame.right });
          }
          break;
        }
        case "shortCircuitRight": {
          consumeStep();
          values.push(requireBoolean(popValue(values), frame.operator));
          break;
        }
        case "arrayElement": {
          frame.values.push(popValue(values));
          if (frame.nextIndex < frame.elements.length) {
            frames.push(
              { ...frame, nextIndex: frame.nextIndex + 1 },
              { type: "eval", node: frame.elements[frame.nextIndex] as Expression },
            );
          } else {
            values.push(Object.freeze(frame.values.slice()));
          }
          break;
        }
        case "callArgument": {
          frame.values.push(popValue(values));
          if (frame.nextIndex < frame.args.length) {
            frames.push(
              { ...frame, nextIndex: frame.nextIndex + 1 },
              { type: "eval", node: frame.args[frame.nextIndex] as Expression },
            );
          } else {
            values.push(invokeStandardFunction(frame.name, frame.values, consumeStep));
          }
          break;
        }
        case "ifCondition": {
          const condition = requireBoolean(popValue(values), "IF");
          frames.push({ type: "eval", node: condition ? frame.whenTrue : frame.whenFalse });
          break;
        }
      }
    }

    if (values.length !== 1) {
      throw new EvaluationError("INTERNAL_ERROR", "Evaluation completed with an invalid value stack", {
        details: { values: values.length },
      });
    }
    return values[0] as AXQLValue;
  } catch (error) {
    if (error instanceof AXQLError) throw error;
    throw new EvaluationError("INTERNAL_ERROR", "Evaluation failed while inspecting an unsafe value", {
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
  }
}

function applyUnary(operator: UnaryOperator, value: AXQLValue): AXQLValue {
  if (operator === "NOT") return !requireBoolean(value, operator);
  if (typeof value !== "number") typeMismatch("Unary '-' requires a number", operator, value);
  const result = -value;
  if (!Number.isFinite(result)) nonFinite(operator);
  return result;
}

function applyBinary(operator: BinaryOperator, left: AXQLValue, right: AXQLValue): AXQLValue {
  if (operator === "=" || operator === "!=") {
    if (Array.isArray(left) || Array.isArray(right)) typeMismatch(`'${operator}' requires scalar operands`, operator, [left, right]);
    return operator === "=" ? left === right : left !== right;
  }
  if (operator === "+" && typeof left === "string" && typeof right === "string") return left + right;
  if (typeof left !== "number" || typeof right !== "number") {
    typeMismatch(`'${operator}' requires two numbers${operator === "+" ? " or two strings" : ""}`, operator, [left, right]);
  }

  let result: number | boolean;
  switch (operator) {
    case "+":
      result = left + right;
      break;
    case "-":
      result = left - right;
      break;
    case "*":
      result = left * right;
      break;
    case "/":
      if (right === 0) {
        throw new EvaluationError("DIVISION_BY_ZERO", "Division by zero is not allowed", { details: { operator } });
      }
      result = left / right;
      break;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    default:
      throw new EvaluationError("INTERNAL_ERROR", `Unexpected binary operator ${operator}`);
  }
  if (!Number.isFinite(result)) nonFinite(operator);
  return result;
}

function requireBoolean(value: AXQLValue, operation: string): boolean {
  if (typeof value !== "boolean") typeMismatch(`${operation} requires a boolean`, operation, value);
  return value;
}

function resolveIdentifier(context: EvaluationContext, path: readonly string[], consumeStep: () => void): AXQLValue {
  let current: unknown = context;
  for (let index = 0; index < path.length; index += 1) {
    consumeStep();
    requireContextContainer(current, path.slice(0, index).join(".") || "context");
    const segment = path[index] as string;
    const descriptor = Object.getOwnPropertyDescriptor(current, segment);
    if (descriptor === undefined) return null;
    if (!("value" in descriptor)) {
      throw new EvaluationError("ACCESSOR_NOT_ALLOWED", `Context property ${path.slice(0, index + 1).join(".")} is an accessor`, {
        details: { path: path.slice(0, index + 1) },
      });
    }
    current = descriptor.value;
    if (index < path.length - 1 && !isContextContainer(current)) {
      throw new EvaluationError("INVALID_CONTEXT", `Cannot traverse through ${path.slice(0, index + 1).join(".")}`, {
        details: { path: path.slice(0, index + 1), actual: describeValue(current) },
      });
    }
  }
  return copyContextValue(current, path.join("."), consumeStep);
}

function copyContextValue(value: unknown, path: string, consumeStep: () => void): AXQLValue {
  if (!Array.isArray(value)) return requireScalarValue(value, path);
  requireArray(value, path);

  interface CloneFrame {
    readonly input: unknown[];
    readonly length: number;
    readonly output: AXQLValue[];
    index: number;
    readonly parent: CloneFrame | undefined;
    readonly parentIndex: number | undefined;
    readonly path: string;
  }

  const root: CloneFrame = {
    input: value,
    length: readArrayLength(value, path),
    output: [],
    index: 0,
    parent: undefined,
    parentIndex: undefined,
    path,
  };
  const stack: CloneFrame[] = [root];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as CloneFrame;
    if (frame.index >= frame.length) {
      const completed = Object.freeze(frame.output.slice());
      stack.pop();
      if (frame.parent === undefined) return completed;
      frame.parent.output[frame.parentIndex as number] = completed;
      continue;
    }

    consumeStep();
    const index = frame.index;
    frame.index += 1;
    const descriptor = Object.getOwnPropertyDescriptor(frame.input, String(index));
    if (descriptor === undefined) {
      frame.output[index] = null;
      continue;
    }
    if (!("value" in descriptor)) {
      throw new EvaluationError("ACCESSOR_NOT_ALLOWED", `Context array element ${frame.path}[${index}] is an accessor`, {
        details: { path: `${frame.path}[${index}]` },
      });
    }
    const element = descriptor.value;
    if (Array.isArray(element)) {
      requireArray(element, `${frame.path}[${index}]`);
      stack.push({
        input: element,
        length: readArrayLength(element, `${frame.path}[${index}]`),
        output: [],
        index: 0,
        parent: frame,
        parentIndex: index,
        path: `${frame.path}[${index}]`,
      });
    } else {
      frame.output[index] = requireScalarValue(element, `${frame.path}[${index}]`);
    }
  }

  throw new EvaluationError("INTERNAL_ERROR", "Context array copying ended unexpectedly");
}

function requireScalarValue(value: unknown, path: string): Exclude<AXQLValue, readonly AXQLValue[]> {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new EvaluationError("NON_FINITE_NUMBER", `Context value ${path} must be finite`, { details: { path, value } });
    }
    return value;
  }
  throw new EvaluationError("INVALID_CONTEXT", `Context value ${path} is not an AXQL value`, {
    details: { path, actual: describeValue(value) },
  });
}

function isContextContainer(value: unknown): value is Record<PropertyKey, unknown> | unknown[] {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return Object.getPrototypeOf(value) === Array.prototype;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function requireContextContainer(value: unknown, path: string): asserts value is Record<PropertyKey, unknown> | unknown[] {
  if (!isContextContainer(value)) {
    throw new EvaluationError("INVALID_CONTEXT", `${path} must be a plain object or array`, {
      details: { path, actual: describeValue(value) },
    });
  }
}

function requireArray(value: unknown[], path: string): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new EvaluationError("INVALID_CONTEXT", `${path} must be a plain array`, { details: { path } });
  }
}

function readArrayLength(value: unknown[], path: string): number {
  const descriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (descriptor === undefined || !("value" in descriptor) || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) {
    throw new EvaluationError("INVALID_CONTEXT", `${path} has an invalid array length`, { details: { path } });
  }
  return descriptor.value as number;
}

function popValue(values: AXQLValue[]): AXQLValue {
  const value = values.pop();
  if (value === undefined) throw new EvaluationError("INTERNAL_ERROR", "Evaluation value stack is empty");
  return value;
}

function typeMismatch(message: string, operation: string, value: unknown): never {
  throw new EvaluationError("TYPE_MISMATCH", message, { details: { operation, actual: describeValue(value) } });
}

function nonFinite(operation: string): never {
  throw new EvaluationError("NON_FINITE_NUMBER", `${operation} produced a non-finite number`, { details: { operation } });
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
