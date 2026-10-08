export type BoardErrorCode =
  | "not_initialized"
  | "not_found"
  | "conflict"
  | "bad_request"
  | "sensitive"
  | "busy"
  | "protocol";

export class BoardError extends Error {
  readonly code: BoardErrorCode;

  constructor(code: BoardErrorCode, message: string) {
    super(message);
    this.name = "BoardError";
    this.code = code;
  }
}

export function exitCodeFor(error: BoardError): number {
  switch (error.code) {
    case "conflict":
      return 2;
    case "sensitive":
      return 3;
    case "not_found":
      return 4;
    case "not_initialized":
      return 5;
    case "busy":
      return 6;
    case "protocol":
    case "bad_request":
      return 1;
  }
}
