import { AXQLError, evaluate, parse, validate, type AXQLValue, type EvaluationContext } from "../../src/index.ts";
import "./style.css";

interface Example {
  readonly title: string;
  readonly description: string;
  readonly expression: string;
  readonly context: string;
}

const examples: readonly Example[] = [
  {
    title: "Invoice approval",
    description: "Compare fields and traverse a nested context.",
    expression: 'amount > 1000 AND currency = "EUR" AND customer.tier != "restricted"',
    context: JSON.stringify({ amount: 1200, currency: "EUR", customer: { tier: "standard" } }, null, 2),
  },
  {
    title: "Risk routing",
    description: "Choose a result with a lazy conditional.",
    expression: 'IF(order.total >= 500 OR order.country = "US", "manual review", "auto approve")',
    context: JSON.stringify({ order: { total: 245, country: "DE" } }, null, 2),
  },
  {
    title: "Allowed status",
    description: "Check membership in a literal array.",
    expression: 'IN(status, ["draft", "pending", "approved"])',
    context: JSON.stringify({ status: "pending" }, null, 2),
  },
  {
    title: "Order total",
    description: "Sum an array and calculate a discount.",
    context: JSON.stringify({ lines: [29.99, 85, 14.5], discount: 0.1 }, null, 2),
    expression: "SUM(lines) * (1 - discount)",
  },
  {
    title: "Strict types",
    description: "AXQL never coerces values during comparison.",
    expression: "numberValue = stringValue",
    context: JSON.stringify({ numberValue: 2, stringValue: "2" }, null, 2),
  },
];

const form = requiredElement<HTMLFormElement>("playground");
const expressionInput = requiredElement<HTMLTextAreaElement>("expression");
const contextInput = requiredElement<HTMLTextAreaElement>("context");
const examplesContainer = requiredElement<HTMLDivElement>("examples");
const status = requiredElement<HTMLParagraphElement>("status");
const result = requiredElement<HTMLPreElement>("result");
const ast = requiredElement<HTMLPreElement>("ast");
const resultState = requiredElement<HTMLSpanElement>("result-state");

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing required element: ${id}`);
  return element as T;
}

function renderExamples(): void {
  examples.forEach((example, index) => {
    const button = document.createElement("button");
    button.className = "example-button";
    button.type = "button";
    button.setAttribute("role", "listitem");
    button.innerHTML = `<span class="example-number">0${index + 1}</span><span><strong>${example.title}</strong><small>${example.description}</small></span>`;
    button.addEventListener("click", () => loadExample(index));
    examplesContainer.append(button);
  });
}

function loadExample(index: number): void {
  const example = examples[index];
  if (example === undefined) return;
  expressionInput.value = example.expression;
  contextInput.value = example.context;
  document.querySelectorAll<HTMLButtonElement>(".example-button").forEach((button, buttonIndex) => {
    button.dataset.active = String(buttonIndex === index);
  });
  evaluateExpression();
}

function evaluateExpression(): void {
  clearInvalidState();
  try {
    const context = readContext(contextInput.value);
    const expression = parse(expressionInput.value, { locations: true });
    validate(expression);
    const value = evaluate(expression, context);

    ast.textContent = formatJson(expression);
    result.textContent = formatValue(value);
    setResultState("success", "VALID");
    status.textContent = "Expression evaluated successfully.";
  } catch (error) {
    const diagnostic = describeError(error);
    result.textContent = diagnostic.message;
    ast.textContent = diagnostic.astMessage;
    setResultState("error", diagnostic.label);
    status.textContent = diagnostic.status;
    diagnostic.field?.setAttribute("aria-invalid", "true");
    diagnostic.field?.focus();
  }
}

function readContext(source: string): EvaluationContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw { type: "context", message: error instanceof Error ? error.message : "Invalid JSON context" };
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw { type: "context", message: "Context must be a JSON object." };
  }
  return parsed as EvaluationContext;
}

function describeError(error: unknown): { readonly label: string; readonly message: string; readonly status: string; readonly astMessage: string; readonly field?: HTMLTextAreaElement } {
  if (isContextError(error)) {
    return {
      label: "CONTEXT",
      message: error.message,
      status: "Fix the JSON context and run again.",
      astMessage: "The AST is unchanged until the context is valid.",
      field: contextInput,
    };
  }
  if (error instanceof AXQLError) {
    const position = error.location === undefined ? "" : ` · line ${error.location.start.line}, column ${error.location.start.column}`;
    const diagnostic = {
      label: error.code,
      message: `${error.phase.toUpperCase()} ERROR${position}\n\n${error.message}`,
      status: `${error.phase} error: ${error.code}.`,
      astMessage: error.phase === "parse" ? "The expression could not be parsed." : "No validated AST is available.",
    };
    return error.phase === "evaluate" ? diagnostic : { ...diagnostic, field: expressionInput };
  }
  return {
    label: "ERROR",
    message: "Unexpected error while evaluating the expression.",
    status: "Unexpected evaluation error.",
    astMessage: "No AST is available.",
  };
}

function isContextError(error: unknown): error is { readonly type: "context"; readonly message: string } {
  return typeof error === "object" && error !== null && "type" in error && error.type === "context" && "message" in error && typeof error.message === "string";
}

function formatValue(value: AXQLValue): string {
  return typeof value === "string" ? JSON.stringify(value) : formatJson(value);
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function clearInvalidState(): void {
  expressionInput.removeAttribute("aria-invalid");
  contextInput.removeAttribute("aria-invalid");
}

function setResultState(state: "idle" | "success" | "error", label: string): void {
  resultState.dataset.state = state;
  resultState.textContent = label;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  evaluateExpression();
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    evaluateExpression();
  }
});

renderExamples();
loadExample(0);
