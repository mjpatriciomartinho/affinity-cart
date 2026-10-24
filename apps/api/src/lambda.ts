import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.ts";
import { runJob, type Job } from "./store.ts";

// On AWS one function does both jobs: it serves HTTP (Function URL) and, when it
// invokes itself asynchronously, runs a pipeline step for up to 15 minutes.

const lambda = new LambdaClient({});
const http = handle(
  createApp(async (id, job) => {
    await lambda.send(
      new InvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        InvocationType: "Event",
        Payload: JSON.stringify({ kind: "job", id, job }),
      }),
    );
  }),
);

type JobEvent = { kind: "job"; id: string; job: Job };

export const handler = async (event: unknown, context: unknown) => {
  const e = event as Partial<JobEvent>;
  if (e.kind === "job" && e.id && e.job) {
    await runJob(e.id, e.job);
    return;
  }
  return http(event as Parameters<typeof http>[0], context as Parameters<typeof http>[1]);
};
