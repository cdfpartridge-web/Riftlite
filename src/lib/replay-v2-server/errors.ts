export class ReplayV2Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ReplayV2Error";
    this.status = status;
    this.code = code;
  }
}

export function replayFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ReplayV2Error) {
    return {
      code: error.code.slice(0, 80),
      message: error.message.slice(0, 300),
    };
  }
  return {
    code: "processing_failed",
    message: "Replay processing failed.",
  };
}
