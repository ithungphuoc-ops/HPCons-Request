import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { copyObject, deleteObject } from "@/lib/r2";
import type { PrintTemplate } from "@/lib/types";

function templatesRef(groupId: string) {
  return adminDb.collection("groups").doc(groupId).collection("printTemplates");
}

function sanitizeFileNameForPath(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function listPrintTemplates(groupId: string): Promise<PrintTemplate[]> {
  const snap = await templatesRef(groupId).orderBy("createdAt").get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PrintTemplate);
}

export async function getPrintTemplate(
  groupId: string,
  templateId: string,
): Promise<PrintTemplate | null> {
  const snap = await templatesRef(groupId).doc(templateId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as PrintTemplate;
}

export async function getDefaultPrintTemplate(groupId: string): Promise<PrintTemplate | null> {
  const snap = await templatesRef(groupId).where("isDefault", "==", true).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() } as PrintTemplate;
}

/**
 * Cập nhật lại kết quả quét biến (detectedVariables/validation) mà KHÔNG
 * đổi file — dùng khi Sếp bấm "Quét lại" sau khi sửa/xoá field của nhóm, vì
 * việc đổi kiểu dữ liệu hoặc xoá field không tự động quét lại mẫu in đang
 * dùng biến đó (mẫu in có thể in ra thiếu dữ liệu mà không có cảnh báo).
 * Tự BỎ mặc định nếu quét lại phát sinh lỗi nghiêm trọng, giống replace file.
 */
export async function updatePrintTemplateValidation(
  groupId: string,
  templateId: string,
  input: { detectedVariables: string[]; validation: { errors: string[]; warnings: string[] } },
): Promise<PrintTemplate> {
  const ref = templatesRef(groupId).doc(templateId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Không tìm thấy mẫu in.");
  const current = snap.data() as Omit<PrintTemplate, "id">;

  const hasErrors = input.validation.errors.length > 0;
  const patch = {
    detectedVariables: input.detectedVariables,
    validation: input.validation,
    updatedAt: new Date().toISOString(),
    ...(hasErrors && current.isDefault ? { isDefault: false } : {}),
  };
  await ref.update(patch);
  return { id: templateId, ...current, ...patch };
}

export interface CreatePrintTemplateInput {
  name: string;
  fileName: string;
  path: string;
  createdBy: { uid: string; name: string };
  detectedVariables: string[];
  validation: { errors: string[]; warnings: string[] };
}

/**
 * Tạo mẫu mới — tự đặt làm mặc định nếu đây là mẫu ĐẦU TIÊN của nhóm VÀ
 * không có lỗi nghiêm trọng (không tự đặt mặc định mẫu đang lỗi, đúng yêu
 * cầu "không cho đặt mẫu làm mặc định nếu có lỗi nghiêm trọng").
 */
export async function createPrintTemplate(
  groupId: string,
  input: CreatePrintTemplateInput,
): Promise<PrintTemplate> {
  const existing = await templatesRef(groupId).limit(1).get();
  const isFirst = existing.empty;
  const now = new Date().toISOString();
  const ref = templatesRef(groupId).doc();
  const doc: Omit<PrintTemplate, "id"> = {
    groupId,
    name: input.name,
    fileName: input.fileName,
    path: input.path,
    isDefault: isFirst && input.validation.errors.length === 0,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    version: 1,
    detectedVariables: input.detectedVariables,
    validation: input.validation,
  };
  await ref.set(doc);
  return { id: ref.id, ...doc };
}

export async function renamePrintTemplate(
  groupId: string,
  templateId: string,
  name: string,
): Promise<void> {
  await templatesRef(groupId)
    .doc(templateId)
    .update({ name, updatedAt: new Date().toISOString() });
}

/** Đặt 1 mẫu làm mặc định — bỏ mặc định của mọi mẫu khác trong cùng nhóm. */
export async function setDefaultPrintTemplate(groupId: string, templateId: string): Promise<void> {
  const all = await templatesRef(groupId).get();
  const batch = adminDb.batch();
  const now = new Date().toISOString();
  all.docs.forEach((doc) => {
    const shouldBeDefault = doc.id === templateId;
    if (doc.data().isDefault !== shouldBeDefault) {
      batch.update(doc.ref, { isDefault: shouldBeDefault, updatedAt: now });
    }
  });
  await batch.commit();
}

export interface ReplacePrintTemplateFileInput {
  fileName: string;
  path: string;
  detectedVariables: string[];
  validation: { errors: string[]; warnings: string[] };
}

/**
 * Thay file của 1 mẫu đã có — xoá file Storage cũ, tăng version, giữ nguyên
 * id/tên. Nếu file mới phát sinh lỗi nghiêm trọng và mẫu này đang là mặc
 * định, tự BỎ mặc định (không được để 1 mẫu lỗi làm mặc định).
 */
export async function replacePrintTemplateFile(
  groupId: string,
  templateId: string,
  input: ReplacePrintTemplateFileInput,
): Promise<PrintTemplate> {
  const ref = templatesRef(groupId).doc(templateId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Không tìm thấy mẫu in.");
  const current = snap.data() as Omit<PrintTemplate, "id">;

  const hasErrors = input.validation.errors.length > 0;
  const patch = {
    fileName: input.fileName,
    path: input.path,
    detectedVariables: input.detectedVariables,
    validation: input.validation,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
    ...(hasErrors && current.isDefault ? { isDefault: false } : {}),
  };
  // Cập nhật Firestore TRƯỚC (đã trỏ sang file mới ở input.path — được lưu
  // vào Storage trước khi hàm này chạy), rồi mới xoá file CŨ — tránh cửa sổ
  // hở khi 1 request khác đang xuất file đọc path cũ nhưng file đã bị xoá.
  await ref.update(patch);
  await deleteObject(current.path);
  return { id: templateId, ...current, ...patch };
}

/**
 * Nhân bản TOÀN BỘ mẫu in của 1 nhóm sang nhóm mới — copy từng file R2 sang
 * path riêng của nhóm mới (KHÔNG dùng chung path với nhóm nguồn, xem lý do ở
 * copyObject()), rồi ghi lại đúng metadata (giữ nguyên name/fileName/
 * isDefault/detectedVariables/validation, đặt lại createdBy = người bấm
 * "Nhân bản", createdAt/updatedAt = thời điểm nhân bản, version reset về 1
 * vì đây là bản file MỚI trong Storage, không phải bản đã qua "Thay file").
 *
 * FAIL-FAST + TỰ DỌN: copy TUẦN TỰ (không song song) và dùng ID document
 * Firestore thật (sinh TRƯỚC khi copy) làm phần định danh trong destPath —
 * không chỉ dựa vào Date.now() (2 mẫu copy cùng lúc có thể trùng mili-giây,
 * ghi đè lẫn nhau — CodeRabbit phát hiện). Nếu 1 mẫu copy lỗi giữa chừng,
 * XOÁ NGAY các file R2 đã copy thành công trước đó rồi throw — để route gọi
 * hàm này biết mà rollback (xoá luôn nhóm mới), KHÔNG được để lọt trường hợp
 * trả về 201 "thành công" trong khi nhóm mới thiếu mẫu in mà không báo gì.
 */
export async function duplicatePrintTemplates(
  sourceGroupId: string,
  targetGroupId: string,
  duplicatedBy: { uid: string; name: string },
): Promise<void> {
  const templates = await listPrintTemplates(sourceGroupId);
  if (templates.length === 0) return;

  const now = new Date().toISOString();
  const targetRef = templatesRef(targetGroupId);
  const copiedPaths: string[] = [];

  try {
    for (const template of templates) {
      const templateRef = targetRef.doc();
      const destPath = `print-templates/${targetGroupId}/${templateRef.id}-${sanitizeFileNameForPath(template.fileName)}`;
      await copyObject(template.path, destPath);
      copiedPaths.push(destPath);
      const doc: Omit<PrintTemplate, "id"> = {
        groupId: targetGroupId,
        name: template.name,
        fileName: template.fileName,
        path: destPath,
        isDefault: template.isDefault,
        createdBy: duplicatedBy,
        createdAt: now,
        updatedAt: now,
        version: 1,
        detectedVariables: template.detectedVariables,
        validation: template.validation,
      };
      await templateRef.set(doc);
    }
  } catch (error) {
    // Dọn lại MỌI file R2 đã copy thành công trước khi lỗi xảy ra — tránh
    // rác trong R2 (các file đó sẽ không có document Firestore nào tham
    // chiếu tới nữa vì route gọi hàm này sẽ xoá luôn nhóm mới ở bước sau).
    await Promise.all(copiedPaths.map((path) => deleteObject(path)));
    throw error instanceof Error
      ? error
      : new Error("Không copy được mẫu in khi nhân bản nhóm.");
  }
}

/** Xoá 1 mẫu — nếu là mẫu mặc định và còn mẫu khác, tự đề bạt mẫu cũ nhất còn lại làm mặc định. */
export async function deletePrintTemplate(groupId: string, templateId: string): Promise<void> {
  const ref = templatesRef(groupId).doc(templateId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() as Omit<PrintTemplate, "id">;

  // Xoá Firestore TRƯỚC để request khác lập tức thấy mẫu đã biến mất (404)
  // thay vì còn đọc được metadata trỏ tới file sắp bị xoá ở Storage.
  await ref.delete();
  await deleteObject(data.path);

  if (data.isDefault) {
    const remaining = await templatesRef(groupId).orderBy("createdAt").limit(1).get();
    if (!remaining.empty) {
      await remaining.docs[0].ref.update({ isDefault: true, updatedAt: new Date().toISOString() });
    }
  }
}
