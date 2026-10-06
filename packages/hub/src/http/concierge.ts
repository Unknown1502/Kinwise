import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';

export interface ConciergeRequest {
  persona: 'resident' | 'caregiver';
  text: string;
  /** The caller's own bearer token: the concierge calls MCP on the user's behalf, like Alexa+ account linking. */
  token: string;
  sessionId: string;
  householdTimezone: string;
  /** This hub's public MCP endpoint, so the concierge needs no static configuration of it. */
  hubMcpUrl: string;
}

export interface ConciergeClient {
  ask(req: ConciergeRequest): Promise<unknown>;
}

/** Local dev: the Strands concierge runs on http://localhost:8081 (AgentCore-compatible /invocations; 8080 inside the container). */
export class HttpConcierge implements ConciergeClient {
  constructor(private readonly baseUrl: string) {}

  async ask(req: ConciergeRequest): Promise<unknown> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/invocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-amzn-bedrock-agentcore-runtime-session-id': req.sessionId },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Concierge returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
}

/** AWS: invoke the concierge hosted on Bedrock AgentCore Runtime. */
export class AgentCoreConcierge implements ConciergeClient {
  constructor(
    private readonly runtimeArn: string,
    private readonly client = new BedrockAgentCoreClient({}),
  ) {}

  async ask(req: ConciergeRequest): Promise<unknown> {
    const out = await this.client.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: this.runtimeArn,
        // AgentCore requires session ids of at least 33 characters.
        runtimeSessionId: req.sessionId.padEnd(33, '0'),
        contentType: 'application/json',
        accept: 'application/json',
        payload: new TextEncoder().encode(JSON.stringify(req)),
      }),
    );
    const body = out.response ? await out.response.transformToString() : '{}';
    return JSON.parse(body);
  }
}
