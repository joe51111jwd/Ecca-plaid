import http from "node:http";
import type { AddressInfo } from "node:net";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";

/** Helpers shared by the webhook and event tests. Not imported by application code. */

/** A synthetic tenant. */
export async function createTestOrg(name = "Synthetic SGO"): Promise<string> {
  const db = await getDb();
  const id = newId("org");
  await db.insert(schema.organizations).values({ id, type: "sgo", name, slug: `synthetic-${id.toLowerCase()}` });
  return id;
}

export interface ReceivedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface ReceiverReply {
  status?: number;
  body?: string | Buffer;
  headers?: Record<string, string>;
  /** Never answer (the request hangs until the sender gives up). */
  hang?: boolean;
}

export interface Receiver {
  /** http://127.0.0.1:<port> */
  origin: string;
  port: number;
  requests: ReceivedRequest[];
  /** Decides the reply for each request (default: 200 "ok"). */
  reply: (fn: (request: ReceivedRequest, index: number) => ReceiverReply) => void;
  close: () => Promise<void>;
}

/** A real HTTP server on an ephemeral loopback port that records what it receives. */
export async function startReceiver(): Promise<Receiver> {
  const requests: ReceivedRequest[] = [];
  let decide: (request: ReceivedRequest, index: number) => ReceiverReply = () => ({ status: 200, body: "ok" });
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const received: ReceivedRequest = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      requests.push(received);
      const reply = decide(received, requests.length - 1);
      if (reply.hang) return;
      res.writeHead(reply.status ?? 200, reply.headers ?? {});
      res.end(reply.body ?? "");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    requests,
    reply: (fn) => {
      decide = fn;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
