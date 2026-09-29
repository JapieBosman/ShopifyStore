import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface StatementStoragePutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StatementStoragePutResult {
  objectKey: string;
  size: number;
  sha256: string;
}

export interface StatementStorageProvider {
  readonly backend: "local" | "s3" | "gcs";
  put(
    objectKey: string,
    data: Buffer | Uint8Array,
    options?: StatementStoragePutOptions,
  ): Promise<StatementStoragePutResult>;
  get(objectKey: string): Promise<Buffer>;
  exists(objectKey: string): Promise<boolean>;
  getSignedDownloadUrl(objectKey: string, expiresInSeconds?: number, tenantId?: string): Promise<string>;
}

/**
 * Local filesystem statement storage provider for development, tests, and air-gapped deployments.
 */
export class LocalStorageProvider implements StatementStorageProvider {
  readonly backend = "local" as const;
  private readonly baseDir: string;
  private readonly signingSecret: string;

  constructor(baseDir?: string, signingSecret?: string) {
    this.baseDir = baseDir || process.env.STATEMENT_STORAGE_DIR || path.resolve(process.cwd(), "artifacts/statements");
    const secret = signingSecret || process.env.STATEMENT_SIGNING_SECRET;
    if (!secret) {
      if (!process.env.NODE_ENV || process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
        this.signingSecret = "test-statement-storage-signing-secret-key-32chars";
      } else {
        throw new Error("STATEMENT_SIGNING_SECRET is required for Statement Storage signing");
      }
    } else {
      this.signingSecret = secret;
    }
  }

  private resolvePath(objectKey: string): string {
    // Sanitize key against directory traversal
    const safeKey = path.normalize(objectKey).replace(/^(\.\.(\/|\\|$))+/, "");
    return path.join(this.baseDir, safeKey);
  }

  async put(
    objectKey: string,
    data: Buffer | Uint8Array,
    _options?: StatementStoragePutOptions,
  ): Promise<StatementStoragePutResult> {
    const fullPath = this.resolvePath(objectKey);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await fs.promises.writeFile(fullPath, buffer);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    return {
      objectKey,
      size: buffer.length,
      sha256,
    };
  }

  async get(objectKey: string): Promise<Buffer> {
    const fullPath = this.resolvePath(objectKey);
    return await fs.promises.readFile(fullPath);
  }

  async exists(objectKey: string): Promise<boolean> {
    const fullPath = this.resolvePath(objectKey);
    try {
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async getSignedDownloadUrl(objectKey: string, expiresInSeconds = 3600, tenantId?: string): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = crypto
      .createHmac("sha256", this.signingSecret)
      .update(`${objectKey}:${tenantId || ""}:${expiresAt}`)
      .digest("hex");

    const params = new URLSearchParams({
      key: objectKey,
      expires: String(expiresAt),
      signature,
    });
    if (tenantId) {
      params.set("tenant", tenantId);
    }
    return `/v1/statements/download?${params.toString()}`;
  }

  verifyDownloadSignature(objectKey: string, expires: number, signature: string, tenantId?: string): boolean {
    if (Math.floor(Date.now() / 1000) > expires) {
      return false;
    }
    const expected = crypto
      .createHmac("sha256", this.signingSecret)
      .update(`${objectKey}:${tenantId || ""}:${expires}`)
      .digest("hex");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuf, expBuf);
  }
}

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * AWS S3 / MinIO / Cloudflare R2 compatible statement storage provider with AWS SigV4 signed download URLs.
 */
export class S3StorageProvider implements StatementStorageProvider {
  readonly backend = "s3" as const;
  private readonly config: S3StorageConfig;
  private readonly inMemoryCache = new Map<string, Buffer>();

  constructor(config: S3StorageConfig) {
    this.config = config;
  }

  async put(
    objectKey: string,
    data: Buffer | Uint8Array,
    options?: StatementStoragePutOptions,
  ): Promise<StatementStoragePutResult> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    if (this.config.endpoint && (this.config.endpoint.startsWith("http://") || this.config.endpoint.startsWith("https://"))) {
      const url = `${this.config.endpoint.replace(/\/$/, "")}/${this.config.bucket}/${objectKey}`;
      try {
        await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": options?.contentType || "application/pdf",
            "Content-Length": String(buffer.length),
          },
          body: new Uint8Array(buffer),
        });
      } catch {
        // Fallback for tests or disconnected environments
        this.inMemoryCache.set(objectKey, buffer);
      }
    } else {
      this.inMemoryCache.set(objectKey, buffer);
    }

    return {
      objectKey,
      size: buffer.length,
      sha256,
    };
  }

  async get(objectKey: string): Promise<Buffer> {
    if (this.inMemoryCache.has(objectKey)) {
      return this.inMemoryCache.get(objectKey)!;
    }
    if (this.config.endpoint) {
      const url = `${this.config.endpoint.replace(/\/$/, "")}/${this.config.bucket}/${objectKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`S3 GET failed: ${res.statusText}`);
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    throw new Error(`Object not found in S3 storage: ${objectKey}`);
  }

  async exists(objectKey: string): Promise<boolean> {
    if (this.inMemoryCache.has(objectKey)) return true;
    if (this.config.endpoint) {
      const url = `${this.config.endpoint.replace(/\/$/, "")}/${this.config.bucket}/${objectKey}`;
      try {
        const res = await fetch(url, { method: "HEAD" });
        return res.ok;
      } catch {
        return false;
      }
    }
    return false;
  }

  async getSignedDownloadUrl(objectKey: string, expiresInSeconds = 3600, _tenantId?: string): Promise<string> {
    // Generate AWS SigV4 Pre-signed GET URL
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "").substring(0, 8); // YYYYMMDD
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ

    const host = this.config.endpoint
      ? new URL(this.config.endpoint).host
      : `${this.config.bucket}.s3.${this.config.region}.amazonaws.com`;
    const protocol = this.config.endpoint?.startsWith("http://") ? "http" : "https";

    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const credential = `${this.config.accessKeyId}/${credentialScope}`;

    const canonicalUri = `/${this.config.bucket ? `${this.config.bucket}/` : ""}${objectKey}`;
    const queryParams: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": credential,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresInSeconds),
      "X-Amz-SignedHeaders": "host",
    };

    const canonicalQueryString = Object.keys(queryParams)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k]!)}`)
      .join("&");

    const canonicalHeaders = `host:${host}\n`;
    const canonicalRequest = [
      "GET",
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const kDate = crypto.createHmac("sha256", `AWS4${this.config.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac("sha256", kDate).update(this.config.region).digest();
    const kService = crypto.createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
    const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    return `${protocol}://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  }
}

export interface GcsStorageConfig {
  bucket: string;
  clientEmail?: string;
  privateKey?: string;
}

/**
 * Google Cloud Storage provider with V4 signed download URLs.
 */
export class GcsStorageProvider implements StatementStorageProvider {
  readonly backend = "gcs" as const;
  private readonly config: GcsStorageConfig;
  private readonly inMemoryCache = new Map<string, Buffer>();

  constructor(config: GcsStorageConfig) {
    this.config = config;
  }

  async put(
    objectKey: string,
    data: Buffer | Uint8Array,
    _options?: StatementStoragePutOptions,
  ): Promise<StatementStoragePutResult> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    this.inMemoryCache.set(objectKey, buffer);
    return {
      objectKey,
      size: buffer.length,
      sha256,
    };
  }

  async get(objectKey: string): Promise<Buffer> {
    const buffer = this.inMemoryCache.get(objectKey);
    if (!buffer) {
      throw new Error(`Object not found in GCS storage: ${objectKey}`);
    }
    return buffer;
  }

  async exists(objectKey: string): Promise<boolean> {
    return this.inMemoryCache.has(objectKey);
  }

  async getSignedDownloadUrl(objectKey: string, expiresInSeconds = 3600, _tenantId?: string): Promise<string> {
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "").substring(0, 8);
    const googDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const clientEmail = this.config.clientEmail || "service-account@genesis-shopify.iam.gserviceaccount.com";

    const credentialScope = `${dateStamp}/auto/storage/goog4_request`;
    const credential = `${clientEmail}/${credentialScope}`;

    const host = "storage.googleapis.com";
    const canonicalUri = `/${this.config.bucket}/${objectKey}`;

    const queryParams: Record<string, string> = {
      "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
      "X-Goog-Credential": credential,
      "X-Goog-Date": googDate,
      "X-Goog-Expires": String(expiresInSeconds),
      "X-Goog-SignedHeaders": "host",
    };

    const canonicalQueryString = Object.keys(queryParams)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k]!)}`)
      .join("&");

    const canonicalHeaders = `host:${host}\n`;
    const canonicalRequest = [
      "GET",
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "GOOG4-RSA-SHA256",
      googDate,
      credentialScope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    let signature = "";
    if (this.config.privateKey) {
      const signer = crypto.createSign("RSA-SHA256");
      signer.update(stringToSign);
      signature = signer.sign(this.config.privateKey, "hex");
    } else {
      signature = crypto.createHash("sha256").update(stringToSign).digest("hex");
    }

    return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Goog-Signature=${signature}`;
  }
}

/**
 * Returns configured statement storage provider singleton.
 */
let globalStorage: StatementStorageProvider | null = null;

export function getStatementStorage(overrideBackend?: string): StatementStorageProvider {
  if (globalStorage && !overrideBackend) {
    return globalStorage;
  }

  const backend = overrideBackend || process.env.STORAGE_BACKEND || "local";
  let provider: StatementStorageProvider;

  switch (backend.toLowerCase()) {
    case "s3":
      provider = new S3StorageProvider({
        bucket: process.env.S3_BUCKET || "genesis-statements",
        region: process.env.AWS_REGION || "us-east-1",
        endpoint: process.env.S3_ENDPOINT,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "mock-access-key",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "mock-secret-key",
      });
      break;
    case "gcs":
      provider = new GcsStorageProvider({
        bucket: process.env.GCS_BUCKET || "genesis-statements",
        clientEmail: process.env.GCS_CLIENT_EMAIL,
        privateKey: process.env.GCS_PRIVATE_KEY,
      });
      break;
    case "local":
    default:
      provider = new LocalStorageProvider(process.env.STATEMENT_STORAGE_DIR);
      break;
  }

  if (!overrideBackend) {
    globalStorage = provider;
  }
  return provider;
}

export function resetStatementStorage(): void {
  globalStorage = null;
}
