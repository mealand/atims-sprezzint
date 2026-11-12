/**
 * Optional S3/MinIO evidence storage (M3.2).
 * If MINIO/S3 config present → presigned PUT URLs for direct browser upload.
 * Otherwise evidence is hash-registered only (the hash is the authority).
 */
const S3_ENDPOINT = process.env.MINIO_ENDPOINT; // e.g. http://minio:9000
const S3_KEY = process.env.MINIO_ACCESS_KEY;
const S3_SECRET = process.env.MINIO_SECRET_KEY;
const S3_BUCKET = process.env.MINIO_BUCKET ?? 'atims-evidence';

export const storageEnabled = Boolean(S3_ENDPOINT && S3_KEY && S3_SECRET);

type Presigner = { getSignedUrl: (cmd: unknown, opts: unknown) => Promise<string> };
type PutCmd = new (input: Record<string, unknown>) => unknown;

let clientPromise: Promise<{ PutObjectCommand: PutCmd; presigner: Presigner }> | null = null;

async function getClient() {
  if (!storageEnabled || clientPromise) return clientPromise;
  clientPromise = (async () => {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl, S3RequestPresigner } = await import('@aws-sdk/s3-request-presigner');
    const client = new S3Client({
      endpoint: S3_ENDPOINT!,
      region: 'us-east-1',
      credentials: { accessKeyId: S3_KEY!, secretAccessKey: S3_SECRET! },
      forcePathStyle: true,
    });
    const presigner = new S3RequestPresigner(client as never);
    return {
      PutObjectCommand: PutObjectCommand as unknown as PutCmd,
      presigner: {
        getSignedUrl: (cmd: unknown, opts: unknown) =>
          getSignedUrl(presigner as never, cmd as never, opts as never) as Promise<string>,
      },
    };
  })();
  return clientPromise;
}

export interface UploadHandle { upload_url: string | null; object_key: string }

export async function presignUpload(entityId: string, batchId: string, fileHashHex: string): Promise<UploadHandle> {
  const object_key = `evidence/${entityId}/${batchId}/${fileHashHex.slice(0, 32)}`;
  const client = await getClient();
  if (!client) return { upload_url: null, object_key };
  const cmd = new client.PutObjectCommand({ Bucket: S3_BUCKET, Key: object_key });
  const upload_url = await client.presigner.getSignedUrl(cmd, { expiresIn: 600 });
  return { upload_url, object_key };
}
