import type {
  BinaryOperator,
  Expression,
  LocatedExpression,
  SourcePosition,
  SourceSpan,
  UnaryOperator,
} from "./ast.js";
import { LimitError, ParseError } from "./errors.js";
import { Lexer, type Token, type TokenKind } from "./lexer.js";
import { resolveLimits, type ExecutionLimits, type LimitOptions } from "./limits.js";

export interface ParseOptions extends LimitOptions {
  readonly locations?: false;
}

export interface LocatedParseOptions extends LimitOptions {
  readonly locations: true;
}

interface ParsedExpression {
  readonly node: Expression;
  readonly depth: number;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export function parse(source: string, options: LocatedParseOptions): LocatedExpression;
export function parse(source: string, options?: ParseOptions): Expression;
export function parse(source: string, options: ParseOptions | LocatedParseOptions = {}): Expression | LocatedExpression {
  if (typeof source !== "string") {
    throw new ParseError("UNEXPECTED_TOKEN", "Expression source must be a string");
  }
  return new Parser(source, resolveLimits(options.limits), options.locations === true).parse();
}

class Parser {
  private readonly lexer: Lexer;
  private current: Token;
  private nodeCount = 0;
  private nesting = 0;

  constructor(
    source: string,
    private readonly limits: ExecutionLimits,
    private readonly includeLocations: boolean,
  ) {
    this.lexer = new Lexer(source);
    this.current = this.lexer.next();
  }

  parse(): Expression | LocatedExpression {
    const expression = this.parseOr();
    if (this.current.kind !== "eof") {
      throw this.unexpected("end of input");
    }
    return expression.node as Expression | LocatedExpression;
  }

  private parseOr(): ParsedExpression {
    let left = this.parseAnd();
    while (this.isKeyword("OR")) {
      this.advance();
      left = this.binary("OR", left, this.parseAnd());
    }
    return left;
  }

  private parseAnd(): ParsedExpression {
    let left = this.parseComparison();
    while (this.isKeyword("AND")) {
      this.advance();
      left = this.binary("AND", left, this.parseComparison());
    }
    return left;
  }

  private parseComparison(): ParsedExpression {
    const left = this.parseAdditive();
    if (!this.isComparison()) return left;

    const operator = this.current.value as BinaryOperator;
    this.advance();
    const result = this.binary(operator, left, this.parseAdditive());
    if (this.isComparison()) {
      throw this.unexpected("a boolean operator or end of expression");
    }
    return result;
  }

  private parseAdditive(): ParsedExpression {
    let left = this.parseMultiplicative();
    while (this.isOperator("+") || this.isOperator("-")) {
      const operator = this.current.value as BinaryOperator;
      this.advance();
      left = this.binary(operator, left, this.parseMultiplicative());
    }
    return left;
  }

  private parseMultiplicative(): ParsedExpression {
    let left = this.parseUnary();
    while (this.isOperator("*") || this.isOperator("/")) {
      const operator = this.current.value as BinaryOperator;
      this.advance();
      left = this.binary(operator, left, this.parseUnary());
    }
    return left;
  }

  private parseUnary(): ParsedExpression {
    if (this.isKeyword("NOT") || this.isOperator("-")) {
      const token = this.current;
      const operator = token.value as UnaryOperator;
      this.advance();
      const argument = this.withNesting(() => this.parseUnary(), token.span);
      return this.create(
        { kind: "unary", op: operator, argument: argument.node },
        argument.depth + 1,
        token.span.start,
        argument.end,
      );
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ParsedExpression {
    const token = this.current;

    if (token.kind === "number" || token.kind === "string") {
      this.advance();
      return this.create({ kind: "literal", value: token.value as number | string }, 1, token.span.start, token.span.end);
    }
    if (token.kind === "keyword" && (typeof token.value === "boolean" || token.value === null)) {
      this.advance();
      return this.create({ kind: "literal", value: token.value }, 1, token.span.start, token.span.end);
    }
    if (token.kind === "identifier") {
      return this.parseIdentifierOrCall();
    }
    if (token.kind === "leftParen") {
      this.advance();
      const expression = this.withNesting(() => this.parseOr(), token.span);
      this.expect("rightParen", "')'");
      return expression;
    }
    if (token.kind === "leftBracket") {
      return this.parseArray();
    }
    throw this.unexpected("a literal, identifier, array, or '('");
  }

  private parseIdentifierOrCall(): ParsedExpression {
    const first = this.current;
    const firstName = first.value as string;
    this.advance();

    if (this.current.kind === "leftParen") {
      const opening = this.current;
      this.advance();
      const args: ParsedExpression[] = [];
      if (!this.isKind("rightParen")) {
        while (true) {
          args.push(this.withNesting(() => this.parseOr(), opening.span));
          if (!this.isKind("comma")) break;
          this.advance();
        }
      }
      const closing = this.expect("rightParen", "')'");
      const depth = 1 + args.reduce((maximum, argument) => Math.max(maximum, argument.depth), 0);
      return this.create(
        { kind: "call", name: firstName.toUpperCase(), arguments: args.map((argument) => argument.node) },
        depth,
        first.span.start,
        closing.span.end,
      );
    }

    const path = [firstName];
    let end = first.span.end;
    while (this.current.kind === "dot") {
      this.advance();
      const segment = this.expect("identifier", "an identifier after '.'");
      path.push(segment.value as string);
      end = segment.span.end;
    }
    return this.create({ kind: "identifier", path }, 1, first.span.start, end);
  }

  private parseArray(): ParsedExpression {
    const opening = this.current;
    this.advance();
    const elements: ParsedExpression[] = [];
    if (this.current.kind !== "rightBracket") {
      while (true) {
        elements.push(this.withNesting(() => this.parseOr(), opening.span));
        if (this.current.kind !== "comma") break;
        this.advance();
      }
    }
    const closing = this.expect("rightBracket", "']'");
    const depth = 1 + elements.reduce((maximum, element) => Math.max(maximum, element.depth), 0);
    return this.create(
      { kind: "array", elements: elements.map((element) => element.node) },
      depth,
      opening.span.start,
      closing.span.end,
    );
  }

  private binary(operator: BinaryOperator, left: ParsedExpression, right: ParsedExpression): ParsedExpression {
    return this.create(
      { kind: "binary", op: operator, left: left.node, right: right.node },
      Math.max(left.depth, right.depth) + 1,
      left.start,
      right.end,
    );
  }

  private create(node: Expression, depth: number, start: SourcePosition, end: SourcePosition): ParsedExpression {
    this.nodeCount += 1;
    if (this.nodeCount > this.limits.maxNodes) {
      throw new LimitError("NODE_LIMIT_EXCEEDED", `Expression exceeds the ${this.limits.maxNodes}-node limit`, {
        phase: "parse",
        details: { limit: this.limits.maxNodes, actual: this.nodeCount },
        location: { start, end },
      });
    }
    if (depth > this.limits.maxDepth) {
      throw new LimitError("DEPTH_LIMIT_EXCEEDED", `Expression exceeds the depth limit of ${this.limits.maxDepth}`, {
        phase: "parse",
        details: { limit: this.limits.maxDepth, actual: depth },
        location: { start, end },
      });
    }

    const result = this.includeLocations ? ({ ...node, loc: { start, end } } as unknown as Expression) : node;
    return { node: result, depth, start, end };
  }

  private withNesting<T>(callback: () => T, location: SourceSpan): T {
    this.nesting += 1;
    if (this.nesting > this.limits.maxDepth) {
      throw new LimitError("DEPTH_LIMIT_EXCEEDED", `Parser nesting exceeds the limit of ${this.limits.maxDepth}`, {
        phase: "parse",
        details: { limit: this.limits.maxDepth, actual: this.nesting },
        location,
      });
    }
    try {
      return callback();
    } finally {
      this.nesting -= 1;
    }
  }

  private isKeyword(keyword: "AND" | "OR" | "NOT"): boolean {
    return this.current.kind === "keyword" && this.current.value === keyword;
  }

  private isKind(kind: TokenKind): boolean {
    return this.current.kind === kind;
  }

  private isOperator(operator: string): boolean {
    return this.current.kind === "operator" && this.current.value === operator;
  }

  private isComparison(): boolean {
    return (
      this.current.kind === "operator" &&
      (this.current.value === "=" ||
        this.current.value === "!=" ||
        this.current.value === "<" ||
        this.current.value === "<=" ||
        this.current.value === ">" ||
        this.current.value === ">=")
    );
  }

  private expect(kind: TokenKind, expected: string): Token {
    if (this.current.kind !== kind) throw this.unexpected(expected);
    const token = this.current;
    this.advance();
    return token;
  }

  private advance(): void {
    this.current = this.lexer.next();
  }

  private unexpected(expected: string): ParseError {
    const found = this.current.kind === "eof" ? "end of input" : JSON.stringify(this.current.value);
    return new ParseError("UNEXPECTED_TOKEN", `Expected ${expected}, found ${found}`, {
      details: { expected, found: this.current.value, token: this.current.kind },
      location: this.current.span,
    });
  }
}
