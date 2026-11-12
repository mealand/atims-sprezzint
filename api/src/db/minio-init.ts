/** Ensure the evidence bucket exists (dev bootstrap). Run: npm run minio-init -w @atims/api */
import 'dotenv/config';
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const endpoint = process.env.MINIO_ENDPOINT;
if (!endpoint) { console.log('MINIO not configured — skipping bucket init'); process.exit(0); }

const client = new S3Client({
  endpoint,
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY!,
    secretAccessKey: process.env.MINIO_SECRET_KEY!,
  },
  forcePathStyle: true,
});
const Bucket = process.env.MINIO_BUCKET ?? 'atims-evidence';

try {
  await client.send(new HeadBucketCommand({ Bucket }));
  console.log(`bucket "${Bucket}" already exists`);
} catch {
  await client.send(new CreateBucketCommand({ Bucket }));
  console.log(`bucket "${Bucket}" created`);
}
