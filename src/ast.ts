export type LiteralValue = string | number | boolean | null;

export type AXQLValue = LiteralValue | readonly AXQLValue[];

export type EvaluationContext = Readonly<Record<string, unknown>>;

export type UnaryOperator = "NOT" | "-";

export type BinaryOperator =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "AND"
  | "OR"
  | "+"
  | "-"
  | "*"
  | "/";

export interface LiteralExpression {
  readonly kind: "literal";
  readonly value: LiteralValue;
}

export interface IdentifierExpression {
  readonly kind: "identifier";
  readonly path: readonly string[];
}

export interface UnaryExpression {
  readonly kind: "unary";
  readonly op: UnaryOperator;
  readonly argument: Expression;
}

export interface BinaryExpression {
  readonly kind: "binary";
  readonly op: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
}

export interface ArrayExpression {
  readonly kind: "array";
  readonly elements: readonly Expression[];
}

export interface CallExpression {
  readonly kind: "call";
  readonly name: string;
  readonly arguments: readonly Expression[];
}

export type Expression =
  | LiteralExpression
  | IdentifierExpression
  | UnaryExpression
  | BinaryExpression
  | ArrayExpression
  | CallExpression;

export interface SourcePosition {
  /** Zero-based UTF-16 code-unit offset. */
  readonly offset: number;
  /** One-based line number. */
  readonly line: number;
  /** One-based UTF-16 code-unit column. */
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

interface LocatedNode {
  readonly loc: SourceSpan;
}

export interface LocatedLiteralExpression extends LocatedNode {
  readonly kind: "literal";
  readonly value: LiteralValue;
}

export interface LocatedIdentifierExpression extends LocatedNode {
  readonly kind: "identifier";
  readonly path: readonly string[];
}

export interface LocatedUnaryExpression extends LocatedNode {
  readonly kind: "unary";
  readonly op: UnaryOperator;
  readonly argument: LocatedExpression;
}

export interface LocatedBinaryExpression extends LocatedNode {
  readonly kind: "binary";
  readonly op: BinaryOperator;
  readonly left: LocatedExpression;
  readonly right: LocatedExpression;
}

export interface LocatedArrayExpression extends LocatedNode {
  readonly kind: "array";
  readonly elements: readonly LocatedExpression[];
}

export interface LocatedCallExpression extends LocatedNode {
  readonly kind: "call";
  readonly name: string;
  readonly arguments: readonly LocatedExpression[];
}

export type LocatedExpression =
  | LocatedLiteralExpression
  | LocatedIdentifierExpression
  | LocatedUnaryExpression
  | LocatedBinaryExpression
  | LocatedArrayExpression
  | LocatedCallExpression;
