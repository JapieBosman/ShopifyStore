import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyShopifyWebhook(
  rawBody: Buffer,
  suppliedHmac: string | string[] | undefined,
  secret: string,
): boolean {
  if (!Buffer.isBuffer(rawBody) || typeof suppliedHmac !== "string" || !secret) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const supplied = Buffer.from(suppliedHmac, "base64");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
