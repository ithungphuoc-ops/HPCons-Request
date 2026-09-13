import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
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

/**
 * Link ký sẵn cho trình duyệt PUT THẲNG file lên R2 — dùng cho tệp lớn hơn
 * trần 4,5MB của serverless function Vercel (13/09/2026). Link chỉ ghi được
 * ĐÚNG 1 key, hết hạn sau `expiresIn` giây.
 *
 * 🔴 Bucket phải bật CORS cho đúng origin của app (PUT + header content-type),
 * nếu không trình duyệt chặn ngay trước khi gọi. Khoá R2 của app KHÔNG có
 * quyền đặt CORS — phải bật tay trên Cloudflare.
 */
export async function createSignedUploadUrl(
  path: string,
  contentType: string,
  contentLength: number,
  expiresIn = 300,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: path,
    ContentType: contentType,
    // 🔴 KÝ LUÔN DUNG LƯỢNG — chốt chặn quan trọng nhất của đường tải thẳng
    // (CodeRabbit bắt 2 lỗi trên PR #15, 13/09/2026):
    //   - Chống phình kho: không thể khai "1MB" rồi đẩy 500MB. R2 đối chiếu
    //     content-length với chữ ký, lệch là trả 403 SignatureDoesNotMatch
    //     (đã thử thật trên bucket production trước khi viết).
    //   - Chống ghi đè sau khi máy chủ đã đo (TOCTOU): link chỉ ghi được ĐÚNG
    //     số byte đã ký, nên kích thước đo lúc đính tệp không thể bị đổi.
    ContentLength: contentLength,
  });
  return getSignedUrl(getR2Client(), command, { expiresIn });
}

/**
 * Kích thước THẬT của object trên R2 — `null` nếu không tồn tại. Dùng để kiểm
 * lại sau khi trình duyệt tải thẳng: con số client khai lúc xin link ký sẵn có
 * thể bịa, không được tin.
 */
export async function headObjectSize(path: string): Promise<number | null> {
  try {
    const res = await getR2Client().send(
      new HeadObjectCommand({ Bucket: getBucketName(), Key: path }),
    );
    return typeof res.ContentLength === "number" ? res.ContentLength : null;
  } catch {
    return null;
  }
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
