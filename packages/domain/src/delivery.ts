import crypto from "node:crypto";

export type DeliveryChannel = "email" | "sms";

export type DeliveryStatus =
  | "queued"
  | "sending"
  | "accepted"
  | "delivered"
  | "bounced"
  | "failed"
  | "uncertain";

export interface RecipientValidationResult {
  valid: boolean;
  error?: string;
  normalizedEmail?: string;
}

/**
 * Validates an email recipient address against standard formatting rules.
 * Strictly rejects header injection (CRLF), control characters, and malformed domains.
 */
export function validateRecipientEmail(email: unknown): RecipientValidationResult {
  if (typeof email !== "string") {
    return { valid: false, error: "Recipient email must be a string" };
  }

  const trimmed = email.trim();
  if (!trimmed) {
    return { valid: false, error: "Recipient email cannot be empty" };
  }

  // Prevent CRLF injection
  if (/[\r\n]/.test(trimmed)) {
    return { valid: false, error: "Recipient email contains forbidden control characters" };
  }

  // RFC 5322 compliant simplified email regex
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: "Recipient email has an invalid format" };
  }

  if (trimmed.length > 254) {
    return { valid: false, error: "Recipient email exceeds maximum allowable length of 254 characters" };
  }

  return { valid: true, normalizedEmail: trimmed.toLowerCase() };
}

function resolveRecipientEncryptionKey(customSecret?: string): Buffer {
  const secret =
    customSecret ||
    process.env.STATEMENT_RECIPIENT_SECRET ||
    process.env.STATEMENT_SIGNING_SECRET;

  if (!secret) {
    if (!process.env.NODE_ENV || process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
      return crypto.createHash("sha256").update("genesis-test-recipient-encryption-key-static").digest();
    }
    throw new Error(
      "STATEMENT_RECIPIENT_SECRET or STATEMENT_SIGNING_SECRET is required to encrypt recipient email addresses",
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a recipient email into an authenticated opaque secret reference string:
 * "enc:v1:<iv_hex>:<ciphertext_hex>:<auth_tag_hex>#<masked>"
 * Preserves GDPR/privacy in DB logs while allowing scheduled workers to decrypt and
 * send directly to the authentic requested recipient.
 */
export function encryptRecipientSecretRef(email: string, secretKey?: string): string {
  const normalized = email.trim().toLowerCase();
  const key = resolveRecipientEncryptionKey(secretKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const parts = normalized.split("@");
  const localPart = parts[0] || "";
  const domainPart = parts[1] || "";
  const maskedLocal =
    localPart.length <= 2
      ? `${localPart.charAt(0)}*`
      : `${localPart.charAt(0)}***${localPart.charAt(localPart.length - 1)}`;

  const hash = crypto.createHash("sha256").update(normalized).digest("hex").substring(0, 8);
  const maskedSuffix = `${maskedLocal}@${domainPart}#${hash}`;

  return `enc:v1:${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}#${maskedSuffix}`;
}

/**
 * Decrypts an encrypted recipient secret reference back to the original recipient email.
 * Returns null if the reference is unencrypted or cannot be verified.
 */
export function decryptRecipientSecretRef(secretRef: string, secretKey?: string): string | null {
  if (!secretRef.startsWith("enc:v1:")) {
    return null;
  }

  // Format: enc:v1:<iv>:<ciphertext>:<tag>#<masked>
  const hashIdx = secretRef.indexOf("#");
  const encPortion = hashIdx !== -1 ? secretRef.substring(0, hashIdx) : secretRef;
  const parts = encPortion.split(":");
  if (parts.length !== 5) {
    return null;
  }

  try {
    const key = resolveRecipientEncryptionKey(secretKey);
    const iv = Buffer.from(parts[2]!, "hex");
    const ciphertext = Buffer.from(parts[3]!, "hex");
    const tag = Buffer.from(parts[4]!, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Generates an opaque, privacy-preserving recipient secret reference
 * storing a masked representation alongside a deterministic hash suffix.
 */
export function generateRecipientSecretRef(email: string): string {
  const normalized = email.trim().toLowerCase();
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").substring(0, 10);
  const parts = normalized.split("@");
  const localPart = parts[0] || "";
  const domainPart = parts[1] || "";
  const maskedLocal =
    localPart.length <= 2
      ? `${localPart.charAt(0)}*`
      : `${localPart.charAt(0)}***${localPart.charAt(localPart.length - 1)}`;
  return `${maskedLocal}@${domainPart}#${hash}`;
}

export interface EmailDispatchPayload {
  tenantId: string;
  deliveryId: string;
  statementId: string;
  idempotencyKey?: string;
  recipientEmail: string;
  recipientName: string;
  accountNumber: string;
  statementNumber: string;
  periodEnd: string;
  closingBalance: string;
  currency: string;
  downloadUrl: string;
  expiresAt: string;
}

export interface EmailDispatchResult {
  providerMessageId: string;
  status: "accepted" | "delivered" | "bounced" | "failed" | "uncertain";
  error?: string;
  providerTimestamp?: string;
}

export type EmailLookupResult =
  | EmailDispatchResult
  | { status: "not_found"; authoritative?: boolean }
  | { status: "unknown"; reason?: string };

export interface QueryDeliveryStatusOptions {
  tenantId?: string;
  providerMessageId?: string | null;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface StatementEmailProvider {
  readonly providerName: string;
  sendStatementEmail(payload: EmailDispatchPayload): Promise<EmailDispatchResult>;
  queryDeliveryStatus?(options: QueryDeliveryStatusOptions): Promise<EmailLookupResult | null>;
}

/**
 * Deterministic in-memory email provider for testing, staging, and offline execution.
 */
export class MockStatementEmailProvider implements StatementEmailProvider {
  readonly providerName = "mock_email";
  public readonly sentEmails: EmailDispatchPayload[] = [];
  private readonly messagesByIdempotencyKey = new Map<string, EmailDispatchResult & { receivedAt: number }>();
  private readonly messagesByScopedKey = new Map<string, EmailDispatchResult & { receivedAt: number }>();
  private simulateStatus: "accepted" | "delivered" | "bounced" | "failed" | "uncertain" = "accepted";
  private simulateError?: string;
  private simulateLookupOutcome?: "accepted" | "delivered" | "bounced" | "failed" | "not_found" | "unknown" | null;
  private simulateLookupReason?: string;
  private delayedVisibilityMs = 0;

  setSimulatedOutcome(
    status: "accepted" | "delivered" | "bounced" | "failed" | "uncertain",
    errorMessage?: string,
  ): void {
    this.simulateStatus = status;
    this.simulateError = errorMessage;
  }

  setSimulatedLookupOutcome(
    outcome: "accepted" | "delivered" | "bounced" | "failed" | "not_found" | "unknown" | null,
    reason?: string,
  ): void {
    this.simulateLookupOutcome = outcome;
    this.simulateLookupReason = reason;
  }

  setDelayedVisibility(delayMs: number): void {
    this.delayedVisibilityMs = delayMs;
  }

  clearSent(): void {
    this.sentEmails.length = 0;
    this.messagesByIdempotencyKey.clear();
    this.messagesByScopedKey.clear();
    this.simulateStatus = "accepted";
    this.simulateError = undefined;
    this.simulateLookupOutcome = null;
    this.simulateLookupReason = undefined;
    this.delayedVisibilityMs = 0;
  }

  async sendStatementEmail(payload: EmailDispatchPayload): Promise<EmailDispatchResult> {
    this.sentEmails.push(payload);

    const messageId = `msg_mock_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();

    let result: EmailDispatchResult;

    if (this.simulateStatus === "failed") {
      result = {
        providerMessageId: messageId,
        status: "failed",
        error: this.simulateError || "Simulated remote SMTP transport rejection (550)",
        providerTimestamp: timestamp,
      };
    } else if (this.simulateStatus === "bounced") {
      result = {
        providerMessageId: messageId,
        status: "bounced",
        error: this.simulateError || "Simulated mailbox unavailable (550 5.1.1 User unknown)",
        providerTimestamp: timestamp,
      };
    } else if (this.simulateStatus === "uncertain") {
      // In a lost response scenario, the provider may have actually accepted the message
      // even though the connection dropped on return!
      result = {
        providerMessageId: messageId,
        status: "uncertain",
        error: this.simulateError || "Provider gateway timeout (504); delivery outcome unverified",
        providerTimestamp: timestamp,
      };
    } else {
      result = {
        providerMessageId: messageId,
        status: this.simulateStatus,
        providerTimestamp: timestamp,
      };
    }

    if (payload.idempotencyKey) {
      const entry = {
        ...result,
        receivedAt: Date.now(),
        // In reality, remote provider records the message even if the client experienced timeout
        status: this.simulateStatus === "uncertain" ? ("accepted" as const) : result.status,
      };
      this.messagesByIdempotencyKey.set(payload.idempotencyKey, entry);
      if (payload.tenantId) {
        this.messagesByScopedKey.set(`${payload.tenantId}:${payload.idempotencyKey}`, entry);
      }
    }

    return result;
  }

  async queryDeliveryStatus(options: QueryDeliveryStatusOptions): Promise<EmailLookupResult | null> {
    if (this.simulateLookupOutcome === "unknown") {
      return { status: "unknown", reason: this.simulateLookupReason || "Simulated provider gateway unknown status" };
    }
    if (this.simulateLookupOutcome === "not_found") {
      return { status: "not_found", authoritative: true };
    }
    if (this.simulateLookupOutcome && this.simulateLookupOutcome !== null) {
      return {
        providerMessageId: options.providerMessageId || `msg_sim_${crypto.randomUUID()}`,
        status: this.simulateLookupOutcome,
        providerTimestamp: new Date().toISOString(),
      };
    }

    if (options.idempotencyKey) {
      let found: (EmailDispatchResult & { receivedAt: number }) | undefined;
      if (options.tenantId) {
        found = this.messagesByScopedKey.get(`${options.tenantId}:${options.idempotencyKey}`);
      }
      if (!found) {
        found = this.messagesByIdempotencyKey.get(options.idempotencyKey);
      }

      if (found) {
        if (this.delayedVisibilityMs > 0 && Date.now() - found.receivedAt < this.delayedVisibilityMs) {
          return { status: "unknown", reason: "Indexing in progress (delayed visibility)" };
        }
        return {
          providerMessageId: found.providerMessageId,
          status: found.status,
          providerTimestamp: found.providerTimestamp,
        };
      }
    }

    if (options.providerMessageId) {
      const match = this.sentEmails.find(
        (p) =>
          (!options.tenantId || p.tenantId === options.tenantId) &&
          (!options.idempotencyKey || p.idempotencyKey === options.idempotencyKey),
      );
      if (match) {
        return {
          providerMessageId: options.providerMessageId,
          status: "accepted",
          providerTimestamp: new Date().toISOString(),
        };
      }
    }

    return { status: "not_found", authoritative: true };
  }
}

/**
 * Webhook/HTTP statement email provider for live external dispatch services.
 */
export class WebhookStatementEmailProvider implements StatementEmailProvider {
  readonly providerName = "webhook_email";
  private readonly endpoint: string;
  private readonly authToken?: string;

  constructor(endpoint: string, authToken?: string) {
    this.endpoint = endpoint;
    this.authToken = authToken;
  }

  async sendStatementEmail(payload: EmailDispatchPayload): Promise<EmailDispatchResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Tenant-Id": payload.tenantId,
      "Idempotency-Key": payload.idempotencyKey || "",
    };
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status === 422 || res.status === 400) {
          const body = await res.json().catch(() => ({}));
          return {
            providerMessageId: "",
            status: "bounced",
            error: (body as { message?: string }).message || `Provider rejected message (${res.status})`,
          };
        }
        return {
          providerMessageId: "",
          status: "uncertain",
          error: `Provider HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = (await res.json().catch(() => ({}))) as {
        messageId?: string;
        id?: string;
        status?: "accepted" | "delivered";
      };

      return {
        providerMessageId: data.messageId || data.id || `msg_wh_${crypto.randomUUID()}`,
        status: data.status || "accepted",
        providerTimestamp: new Date().toISOString(),
      };
    } catch (err) {
      clearTimeout(timeout);
      return {
        providerMessageId: "",
        status: "uncertain",
        error: (err as Error).message || "Connection timeout to email provider gateway",
      };
    }
  }

  async queryDeliveryStatus(options: QueryDeliveryStatusOptions): Promise<EmailLookupResult | null> {
    if (!options.idempotencyKey && !options.providerMessageId) return null;
    const queryUrl = new URL(this.endpoint);
    if (options.tenantId) queryUrl.searchParams.set("tenantId", options.tenantId);
    if (options.idempotencyKey) queryUrl.searchParams.set("idempotencyKey", options.idempotencyKey);
    if (options.providerMessageId) queryUrl.searchParams.set("messageId", options.providerMessageId);

    const headers: Record<string, string> = {};
    if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;
    if (options.tenantId) headers["X-Tenant-Id"] = options.tenantId;

    const timeoutMs = options.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(queryUrl.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status === 404) {
          const body = (await res.json().catch(() => ({}))) as { status?: string; authoritative?: boolean };
          return body.authoritative !== undefined
            ? { status: "not_found", authoritative: body.authoritative }
            : { status: "not_found" };
        }
        return null;
      }

      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        messageId?: string;
        reason?: string;
        providerTimestamp?: string;
        authoritative?: boolean;
      };

      if (data.status === "not_found") {
        return data.authoritative !== undefined
          ? { status: "not_found", authoritative: data.authoritative }
          : { status: "not_found" };
      }
      if (data.status === "unknown") {
        return { status: "unknown", reason: data.reason || "Provider reported unknown status" };
      }
      if (["accepted", "delivered", "bounced", "failed"].includes(data.status as any)) {
        return {
          providerMessageId: data.messageId || options.providerMessageId || "",
          status: data.status as any,
          providerTimestamp: data.providerTimestamp || new Date().toISOString(),
        };
      }
      return null;
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }
}

let activeEmailProvider: StatementEmailProvider | null = null;

export function getStatementEmailProvider(): StatementEmailProvider {
  if (activeEmailProvider) {
    return activeEmailProvider;
  }

  const webhookEndpoint = process.env.STATEMENT_EMAIL_WEBHOOK_URL;
  if (webhookEndpoint) {
    activeEmailProvider = new WebhookStatementEmailProvider(
      webhookEndpoint,
      process.env.STATEMENT_EMAIL_API_KEY,
    );
    return activeEmailProvider;
  }

  // Strictly require live configuration outside of tests.
  // Never silently fall back to mock outside of explicit test mode.
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "STATEMENT_EMAIL_WEBHOOK_URL is required to dispatch statement emails in non-test runtimes. Configure a live email provider gateway.",
    );
  }

  activeEmailProvider = new MockStatementEmailProvider();
  return activeEmailProvider;
}

export function setStatementEmailProvider(provider: StatementEmailProvider | null): void {
  activeEmailProvider = provider;
}
