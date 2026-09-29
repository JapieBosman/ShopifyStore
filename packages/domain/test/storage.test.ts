import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  LocalStorageProvider,
  S3StorageProvider,
  GcsStorageProvider,
  getStatementStorage,
  resetStatementStorage,
} from "../src/storage.ts";

test("storage: LocalStorageProvider stores, verifies exists, retrieves, and validates signed download URLs", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-storage-test-"));
  try {
    const provider = new LocalStorageProvider(tempDir, "test-signing-secret");
    const testData = Buffer.from("%PDF-1.4 test binary statement content");
    const objectKey = "statements/tenant-123/run-456/ACC001.pdf";

    assert.equal(await provider.exists(objectKey), false);

    const putRes = await provider.put(objectKey, testData);
    assert.equal(putRes.objectKey, objectKey);
    assert.equal(putRes.size, testData.length);
    assert.ok(putRes.sha256);

    assert.equal(await provider.exists(objectKey), true);

    const retrieved = await provider.get(objectKey);
    assert.deepEqual(retrieved, testData);

    // Signed download URL
    const signedUrl = await provider.getSignedDownloadUrl(objectKey, 60);
    assert.ok(signedUrl.startsWith("/v1/statements/download?"));

    const urlObj = new URL(signedUrl, "http://localhost");
    const key = urlObj.searchParams.get("key")!;
    const expires = Number(urlObj.searchParams.get("expires")!);
    const signature = urlObj.searchParams.get("signature")!;

    assert.equal(key, objectKey);
    assert.ok(expires > Math.floor(Date.now() / 1000));
    assert.equal(provider.verifyDownloadSignature(key, expires, signature), true);

    // Tampered signature fails
    assert.equal(provider.verifyDownloadSignature(key, expires, "bad-signature"), false);

    // Expired signature fails
    assert.equal(provider.verifyDownloadSignature(key, Math.floor(Date.now() / 1000) - 10, signature), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("storage: S3StorageProvider generates AWS SigV4 signed download URL and handles cache", async () => {
  const s3Provider = new S3StorageProvider({
    bucket: "trade-statements-prod",
    region: "af-south-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  });

  const testData = Buffer.from("%PDF-1.4 S3 statement content");
  const objectKey = "statements/tenant-1/statement.pdf";

  const putRes = await s3Provider.put(objectKey, testData);
  assert.equal(putRes.size, testData.length);

  assert.equal(await s3Provider.exists(objectKey), true);
  const fetched = await s3Provider.get(objectKey);
  assert.deepEqual(fetched, testData);

  const signedUrl = await s3Provider.getSignedDownloadUrl(objectKey, 3600);
  assert.ok(signedUrl.includes("trade-statements-prod.s3.af-south-1.amazonaws.com"));
  assert.ok(signedUrl.includes("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
  assert.ok(signedUrl.includes("X-Amz-Credential="));
  assert.ok(signedUrl.includes("X-Amz-Signature="));
});

test("storage: GcsStorageProvider generates Google V4 signed download URL and handles cache", async () => {
  const gcsProvider = new GcsStorageProvider({
    bucket: "gcs-trade-statements",
    clientEmail: "genesis-sa@project.iam.gserviceaccount.com",
  });

  const testData = Buffer.from("%PDF-1.4 GCS statement content");
  const objectKey = "statements/tenant-2/statement.pdf";

  const putRes = await gcsProvider.put(objectKey, testData);
  assert.equal(putRes.size, testData.length);

  assert.equal(await gcsProvider.exists(objectKey), true);
  const fetched = await gcsProvider.get(objectKey);
  assert.deepEqual(fetched, testData);

  const signedUrl = await gcsProvider.getSignedDownloadUrl(objectKey, 3600);
  assert.ok(signedUrl.includes("storage.googleapis.com/gcs-trade-statements"));
  assert.ok(signedUrl.includes("X-Goog-Algorithm=GOOG4-RSA-SHA256"));
  assert.ok(signedUrl.includes("X-Goog-Signature="));
});

test("storage: factory returns appropriate provider according to environment or override", () => {
  resetStatementStorage();

  const local = getStatementStorage("local");
  assert.equal(local.backend, "local");

  const s3 = getStatementStorage("s3");
  assert.equal(s3.backend, "s3");

  const gcs = getStatementStorage("gcs");
  assert.equal(gcs.backend, "gcs");

  resetStatementStorage();
});
