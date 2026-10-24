import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { runJob } from "./store.ts";

// Local development: steps run in this process, in the background.
const app = createApp(async (id, job) => {
  void runJob(id, job).catch((e) => console.error(`[${job}]`, e));
});

serve({ fetch: app.fetch, port: 8787 }, (info) => console.log(`API on http://localhost:${info.port}/v1`));
