import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

/** One request the package sent to the model. */
export interface SentRequest {
  url: string;
  authorization: string | null;
  model: string;
  state: unknown;
  questions: Record<string, { type: string; instructions: unknown }>;
}

type Reply = { probabilities: number[] } | { status: number; body: unknown };

/**
 * Stand in for the model behind `fetch`: each request gets the next reply,
 * the last reply repeating. A probabilities reply answers the questions in
 * order. Returns the requests as they arrive.
 */
export function fakeModel(...replies: Reply[]): SentRequest[] {
  const sent: SentRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body));
      sent.push({
        url,
        authorization: headers.get("authorization"),
        model: body.model,
        state: body.state,
        questions: body.questions,
      });
      const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
      if ("status" in reply) {
        return new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { "content-type": "application/json" },
        });
      }
      const names = Object.keys(body.questions);
      if (reply.probabilities.length !== names.length) {
        throw new Error(
          `fakeModel got ${names.length} questions but has ${reply.probabilities.length} probabilities`,
        );
      }
      // The real Gateway doesn't keep the questions' order in its answers, so neither does this.
      const answers: Record<string, { type: "noul"; noul: number }> = {};
      for (const i of names.map((_, i) => i).reverse()) {
        answers[names[i]] = { type: "noul", noul: reply.probabilities[i] };
      }
      return Response.json({
        model: body.model,
        answers,
        usage: { input_tokens: 100, output_tokens: 0 },
      });
    }),
  );
  return sent;
}

/** Jev's refusal of content too long to judge, as the AI Gateway relays it. */
export const tooLongRefusal = {
  status: 400,
  body: { error: { message: '{"error_type":"max_tokens_exceeded"}' } },
};

/** A guardrails file holding `yaml`, in a fresh directory; returns its path. */
export function guardrailsFile(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "guardrails-"));
  const path = join(dir, "guardrails.yaml");
  writeFileSync(path, yaml);
  return path;
}

/** A file holding `text` in a fresh directory; returns its path. */
export function contentFile(name: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "content-"));
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

/** Only an AI Gateway key in the environment. */
export function gatewayKeyOnly(): void {
  vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
  vi.stubEnv("TYPESAFE_API_KEY", "");
}
