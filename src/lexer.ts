import type { SourcePosition, SourceSpan } from "./ast.js";
import { ParseError } from "./errors.js";

export type TokenKind =
  | "number"
  | "string"
  | "identifier"
  | "keyword"
  | "operator"
  | "leftParen"
  | "rightParen"
  | "leftBracket"
  | "rightBracket"
  | "comma"
  | "dot"
  | "eof";

export interface Token {
  readonly kind: TokenKind;
  readonly value: string | number | boolean | null;
  readonly span: SourceSpan;
}

const KEYWORDS = new Set(["AND", "OR", "NOT", "TRUE", "FALSE", "NULL"]);

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

export class Lexer {
  private offset = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly source: string) {}

  next(): Token {
    this.skipWhitespace();
    const start = this.position();
    const character = this.peek();

    if (character === undefined) {
      return this.token("eof", "", start);
    }
    if (isDigit(character)) {
      return this.readNumber(start);
    }
    if (character === '"') {
      return this.readString(start);
    }
    if (isIdentifierStart(character)) {
      return this.readIdentifier(start);
    }

    switch (character) {
      case "(":
        this.advance();
        return this.token("leftParen", character, start);
      case ")":
        this.advance();
        return this.token("rightParen", character, start);
      case "[":
        this.advance();
        return this.token("leftBracket", character, start);
      case "]":
        this.advance();
        return this.token("rightBracket", character, start);
      case ",":
        this.advance();
        return this.token("comma", character, start);
      case ".":
        this.advance();
        return this.token("dot", character, start);
      case "+":
      case "-":
      case "*":
      case "/":
      case "=":
        this.advance();
        return this.token("operator", character, start);
      case "!":
        this.advance();
        if (this.peek() !== "=") {
          throw this.error("INVALID_CHARACTER", "Expected '=' after '!'", start);
        }
        this.advance();
        return this.token("operator", "!=", start);
      case "<":
      case ">": {
        this.advance();
        let operator = character;
        if (this.peek() === "=") {
          operator += this.advance();
        }
        return this.token("operator", operator, start);
      }
      default:
        this.advance();
        throw this.error("INVALID_CHARACTER", `Unexpected character ${JSON.stringify(character)}`, start);
    }
  }

  private readNumber(start: SourcePosition): Token {
    const numberStart = this.offset;

    if (this.peek() === "0") {
      this.advance();
      if (isDigit(this.peek())) {
        throw this.error("INVALID_NUMBER", "Numbers cannot contain leading zeroes", start);
      }
    } else {
      while (isDigit(this.peek())) this.advance();
    }

    if (this.peek() === ".") {
      this.advance();
      if (!isDigit(this.peek())) {
        throw this.error("INVALID_NUMBER", "A decimal point must be followed by a digit", start);
      }
      while (isDigit(this.peek())) this.advance();
    }

    if (this.peek() === "e" || this.peek() === "E") {
      this.advance();
      if (this.peek() === "+" || this.peek() === "-") this.advance();
      if (!isDigit(this.peek())) {
        throw this.error("INVALID_NUMBER", "An exponent must contain at least one digit", start);
      }
      while (isDigit(this.peek())) this.advance();
    }

    const raw = this.source.slice(numberStart, this.offset);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw this.error("INVALID_NUMBER", "Number literals must be finite", start);
    }
    return this.token("number", value, start);
  }

  private readString(start: SourcePosition): Token {
    const stringStart = this.offset;
    this.advance();
    let escaped = false;

    while (true) {
      const character = this.peek();
      if (character === undefined) {
        throw this.error("INVALID_STRING", "Unterminated string literal", start);
      }
      if (!escaped && character === '"') {
        this.advance();
        break;
      }
      if (!escaped && (character === "\n" || character === "\r" || character.charCodeAt(0) < 0x20)) {
        throw this.error("INVALID_STRING", "String literals cannot contain unescaped control characters", start);
      }
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      }
      this.advance();
    }

    const raw = this.source.slice(stringStart, this.offset);
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value !== "string") throw new Error("not a string");
      return this.token("string", value, start);
    } catch {
      throw this.error("INVALID_STRING", "String literal contains an invalid JSON escape", start);
    }
  }

  private readIdentifier(start: SourcePosition): Token {
    const identifierStart = this.offset;
    this.advance();
    while (isIdentifierPart(this.peek())) this.advance();
    const value = this.source.slice(identifierStart, this.offset);
    const upper = value.toUpperCase();

    if (!KEYWORDS.has(upper)) {
      return this.token("identifier", value, start);
    }
    if (upper === "TRUE") return this.token("keyword", true, start);
    if (upper === "FALSE") return this.token("keyword", false, start);
    if (upper === "NULL") return this.token("keyword", null, start);
    return this.token("keyword", upper, start);
  }

  private skipWhitespace(): void {
    while (true) {
      const character = this.peek();
      if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") return;
      this.advance();
    }
  }

  private peek(): string | undefined {
    return this.source[this.offset];
  }

  private advance(): string {
    const character = this.source[this.offset] ?? "";
    this.offset += 1;
    if (character === "\n" || character === "\r") {
      if (character === "\r" && this.source[this.offset] === "\n") this.offset += 1;
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return character;
  }

  private position(): SourcePosition {
    return { offset: this.offset, line: this.line, column: this.column };
  }

  private token(kind: TokenKind, value: Token["value"], start: SourcePosition): Token {
    return { kind, value, span: { start, end: this.position() } };
  }

  private error(code: "INVALID_CHARACTER" | "INVALID_NUMBER" | "INVALID_STRING", message: string, start: SourcePosition): ParseError {
    return new ParseError(code, message, { location: { start, end: this.position() } });
  }
}
