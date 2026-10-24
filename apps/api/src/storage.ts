import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { CacheStore } from "@affinity-cart/core";

// JSON blobs by key: on disk in development, in a private S3 bucket on AWS.
export interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export class FileStorage implements Storage {
  constructor(private dir: string) {}
  async get<T>(key: string) {
    try {
      return JSON.parse(await readFile(path.join(this.dir, key), "utf8")) as T;
    } catch {
      return undefined;
    }
  }
  async put(key: string, value: unknown) {
    const file = path.join(this.dir, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }
}

export class S3Storage implements Storage {
  private s3 = new S3Client({});
  constructor(private bucket: string) {}
  async get<T>(key: string) {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return JSON.parse(await r.Body!.transformToString()) as T;
    } catch (e) {
      if (e instanceof NoSuchKey) return undefined;
      throw e;
    }
  }
  async put(key: string, value: unknown) {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: JSON.stringify(value), ContentType: "application/json" }),
    );
  }
}

/** Qloo response cache on top of any Storage. Server-side caching is allowed by the hackathon terms. */
export class StorageCache implements CacheStore {
  constructor(private storage: Storage, private prefix = "qloo-cache/") {}
  private k(key: string) {
    return `${this.prefix}${createHash("sha1").update(key).digest("hex")}.json`;
  }
  get(key: string) {
    return this.storage.get(this.k(key));
  }
  set(key: string, value: unknown) {
    return this.storage.put(this.k(key), value);
  }
}

export function storageFromEnv(): Storage {
  return process.env.STATE_BUCKET
    ? new S3Storage(process.env.STATE_BUCKET)
    : new FileStorage(path.resolve(process.cwd(), ".cache"));
}
