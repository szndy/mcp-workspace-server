/** An error whose message is safe to show to the agent. Anything else is logged and hidden. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}
