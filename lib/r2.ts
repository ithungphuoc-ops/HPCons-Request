import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Lưu tài liệu đính kèm + mẫu in (.docx) trên Cloudflare R2 (tương thích S3)
 * thay cho Firebase Storage — bucket "hpcons-request", KHÔNG public (không
 * gắn custom domain làm base URL công khai như các app khác), vì file ở đây
 * riêng tư theo từng đề xuất/nhóm — chỉ phát link tải có chữ ký, hết hạn sau
 * khi đã kiểm tra quyền ở route gọi, giữ đúng mô hình bảo mật cũ.
 */

let client: S3Client | undefined;

function getR2Client(): S3Client {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return client;
}

function getBucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("Thiếu R2_BUCKET_NAME.");
  return bucket;
}

/** Ghi file trực tiếp từ server (route nhận multipart/form-data upload thẳng). */
export async function putObject(path: string, body: Buffer, contentType: string): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({ Bucket: getBucketName(), Key: path, Body: body, ContentType: contentType }),
  );
}

/** Tải nguyên buffer về server — dùng khi cần đọc nội dung file (quét biến mẫu in, render docx...). */
export async function downloadObject(path: string): Promise<Buffer> {
  const res = await getR2Client().send(new GetObjectCommand({ Bucket: getBucketName(), Key: path }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** Presigned GET URL riêng tư — chỉ phát sau khi route đã tự kiểm tra quyền, hết hạn sau 5 phút. */
export async function createSignedReadUrl(path: string, expiresIn = 300): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucketName(), Key: path });
  return getSignedUrl(getR2Client(), command, { expiresIn });
}

/**
 * Copy 1 object sang path mới NGAY TRONG bucket (server-side, không tải về
 * rồi tải lại) — dùng khi nhân bản nhóm để mẫu in của bản sao có file R2
 * RIÊNG, không trỏ chung path với nhóm nguồn (nếu dùng chung, "Thay file" hay
 * "Xoá mẫu" ở nhóm nguồn sau này sẽ xoá luôn file mà nhóm bản sao đang tham
 * chiếu, làm mẫu in của bản sao vỡ mà không có cảnh báo).
 */
export async function copyObject(sourcePath: string, destPath: string): Promise<void> {
  const bucket = getBucketName();
  await getR2Client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${encodeURIComponent(sourcePath)}`,
      Key: destPath,
    }),
  );
}

/** Xoá file cũ (thay/xoá mẫu in). Bỏ qua lỗi — không chặn thao tác chính nếu xoá thất bại. */
export async function deleteObject(path: string): Promise<void> {
  await getR2Client()
    .send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: path }))
    .catch(() => {});
}
