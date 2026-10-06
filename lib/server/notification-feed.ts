import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { buildNotificationFeed, READ_ENTRY_WINDOW_DAYS, type NotificationFeed } from "@/lib/notification-feed";
import { expandMentionsToUids } from "@/lib/server/mentions";
import { getNotificationSettings } from "@/lib/server/notificationSettings";
import { resolveDirectManagerId, toProposalGroup } from "@/lib/server/requests";
import type { ProposalGroup, RequestInstance } from "@/lib/types";

/**
 * Tải dữ liệu cho chuông thông báo của 1 người — 1 lượt đọc các đề xuất CÒN HIỆU LỰC
 * (`deletedAt == null`; đo 06/10/2026: 35/230 đề xuất, ~0,4 giây so với ~1,9 giây khi
 * đọc cả kho 4 lần như trước), rồi tính bằng buildNotificationFeed (lib/notification-feed.ts).
 */
export async function loadLiveRequests(): Promise<RequestInstance[]> {
  const snap = await adminDb.collection("requests").where("deletedAt", "==", null).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as RequestInstance).filter((r) => r.status !== "draft");
}

/** Quản lý trực tiếp bị "qua mặt": nhóm bật notifyManager + có bước submitter_manager,
 * quản lý trực tiếp của người gửi CHÍNH LÀ `uid` nhưng không có trong approversSnapshot.
 * Cùng luật với scope=manager-bypassed cũ (app/api/requests/route.ts), nhưng bỏ NHÁP
 * và tra song song (trước đây chờ tuần tự từng đề xuất). */
async function findBypassedRequestIds(requests: RequestInstance[], uid: string): Promise<Set<string>> {
  const candidates = requests.filter((r) => r.groupId && r.submittedBy.uid !== uid && !r.approversSnapshot.some((a) => a.id === uid));
  const groupIds = [...new Set(candidates.map((r) => r.groupId!))];
  const groups = new Map<string, ProposalGroup | null>();
  await Promise.all(
    groupIds.map(async (id) => {
      const g = await adminDb.collection("groups").doc(id).get();
      groups.set(id, g.exists ? toProposalGroup(g.id, g.data()!) : null);
    }),
  );
  const eligible = candidates.filter((r) => {
    const g = groups.get(r.groupId!);
    return g?.notifyManager && g.approverSteps.some((s) => s.kind === "submitter_manager");
  });
  const submitters = [...new Set(eligible.map((r) => r.submittedBy.uid))];
  const managers = new Map<string, string | null>();
  await Promise.all(submitters.map(async (s) => managers.set(s, await resolveDirectManagerId(s).catch(() => null))));
  return new Set(eligible.filter((r) => managers.get(r.submittedBy.uid) === uid).map((r) => r.id));
}

/** Bình luận gần đây nhắc tới `uid` QUA PHÒNG BAN (mentionIds là id phòng ban). Chỉ xét
 * bình luận trong cửa sổ hiển thị, đề xuất mà uid có trong `mentionedUids` (đã giãn sẵn
 * lúc tạo bình luận), và bình luận chưa nhắc thẳng uid — nên rất ít lượt tra. */
async function findGroupMentionCommentIds(requests: RequestInstance[], uid: string, now: number): Promise<Set<string>> {
  const floor = new Date(now - READ_ENTRY_WINDOW_DAYS * 86_400_000).toISOString();
  const jobs: { id: string; mentionIds: string[]; author: string }[] = [];
  for (const r of requests) {
    if (!r.mentionedUids?.includes(uid)) continue;
    for (const c of r.comments ?? []) {
      if (c.at < floor || c.authorUid === uid || !c.mentionIds?.length || c.mentionIds.includes(uid)) continue;
      jobs.push({ id: c.id, mentionIds: c.mentionIds, author: c.authorUid });
    }
  }
  const out = new Set<string>();
  await Promise.all(
    jobs.map(async (j) => {
      const uids = await expandMentionsToUids(j.mentionIds, j.author).catch(() => [] as string[]);
      if (uids.includes(uid)) out.add(j.id);
    }),
  );
  return out;
}

export async function loadNotificationFeed(session: { uid: string; name: string }): Promise<NotificationFeed> {
  const now = Date.now();
  const [requests, settings] = await Promise.all([loadLiveRequests(), getNotificationSettings(session.uid)]);
  const [bypassedRequestIds, groupMentionCommentIds] = await Promise.all([
    settings.manager_bypassed === false ? Promise.resolve(new Set<string>()) : findBypassedRequestIds(requests, session.uid),
    settings.mentioned === false ? Promise.resolve(new Set<string>()) : findGroupMentionCommentIds(requests, session.uid, now),
  ]);
  return buildNotificationFeed(requests, {
    uid: session.uid,
    name: session.name,
    settings,
    now,
    bypassedRequestIds,
    groupMentionCommentIds,
  });
}
