import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

// Secrets resolve in order: env vars → repo-root .env (gitignored) → AWS SSM,
// where they live as whole .env files under /servikaki/secrets/<file>.
const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const cache = new Map<string, Promise<Record<string, string>>>();

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#") || !l.includes("=")) continue;
    const i = l.indexOf("=");
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function loadEnvFile(envFile: string) {
  let p = cache.get(envFile);
  if (!p) {
    // Locally we use the named profile; in Lambda, the function's own role.
    const inLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    const ssm = new SSMClient({
      region: "eu-west-1",
      ...(inLambda ? {} : { profile: process.env.SECRETS_PROFILE ?? "servikaki-secrets" }),
    });
    p = ssm
      .send(new GetParameterCommand({ Name: `/servikaki/secrets/${envFile}`, WithDecryption: true }))
      .then((r) => parseEnv(r.Parameter?.Value ?? ""));
    cache.set(envFile, p);
  }
  return p;
}

export async function getKey(envFile: string, key: string): Promise<string> {
  if (process.env[key]) return process.env[key]!;
  // Declared but blank in .env means "not filled in yet", not "fall back to SSM".
  if (key in process.env) throw new Error(`${key} is empty in .env`);
  const v = (await loadEnvFile(envFile))[key];
  if (!v) throw new Error(`${key} not found in ${envFile}`);
  return v;
}
