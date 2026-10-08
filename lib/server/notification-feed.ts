import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import {
  buildNotificationFeed,
  feedCandidateRequests,
  feedRecipientCandidates,
  NOTIFICATION_FEED_COLLECTION,
  NOTIFICATION_FEED_VERSION,
  READ_ENTRY_WINDOW_DAYS,
  sameFeedContent,
  type NotificationFeed,
  type StoredNotificationFeed,
} from "@/lib/notification-feed";
import { expandMentionsToUids } from "@/lib/server/mentions";
import { getNotificationSettings } from "@/lib/server/notificationSettings";
import { resolveDirectManagerId, toProposalGroup } from "@/lib/server/requests";
import type { NotificationSettings, ProposalGroup, RequestInstance } from "@/lib/types";

/**
 * Chuông thông báo — phần máy chủ.
 *
 * Đợt 1 (06/10/2026): mỗi trình duyệt tự gọi GET /api/notifications, route đó đọc mọi
 * đề xuất còn hiệu lực rồi tính. Mọi sự kiện ở bất kỳ đâu (tài liệu tín hiệu chung
 * `system/notification-signal`) làm MỌI tab đang mở — kể cả tab ẩn — gọi lại route này,
 * thêm 2 phút/lần dự phòng → tốn CPU Vercel theo số người đang mở app.
 *
 * Cấp 2 (Sếp duyệt 08/10/2026): tính 1 lần ở nơi xảy ra sự kiện, CHỈ cho những người bị
 * ảnh hưởng, ghi vào `notification-feed/{uid}`; trình duyệt nghe tài liệu của chính mình
 * (lib/firebase/notification-feed-listener.ts), không còn hỏi vòng. Số lượt ghi mỗi sự
 * kiện ≈ số người liên quan tới đề xuất đó (thường < 20), và chỉ ghi khi danh sách thật
 * sự đổi. Người CHƯA có tài liệu (chưa mở app từ khi lên bản này) thì bỏ qua — lần đầu
 * mở chuông họ gọi GET, route đó tính + ghi (bù dần, không cần chạy chuyển dữ liệu).
 *
 * 2 đường tính:
 *  - PHIÊN (GET, đánh dấu đã đọc hết, đổi cài đặt): đọc CẢ kho đề xuất còn hiệu lực, tên +
 *    cài đặt mới nhất, ghi `profileAt` — luôn đúng tuyệt đối, là "mốc chuẩn".
 *  - SỰ KIỆN: chỉ đọc đề xuất có thể hiện trên chuông (feedCandidateRequests — chờ duyệt,
 *    có điều chỉnh chờ, biến động 14 ngày gần đây, hoặc đang được theo dõi trong tài liệu),
 *    dùng tên + cài đặt lưu kèm. Chi phí không tăng theo số đề xuất cũ đã xong.
 */

const feedCol = () => adminDb.collection(NOTIFICATION_FEED_COLLECTION);

interface LiveRequests {
  requests: RequestInstance[];
  /** Thời điểm Firestore đọc kho (ms) — mốc `basedOn` của mọi bản tính từ lượt đọc này. */
  readTimeMs: number;
}

const readMs = (snap: { readTime?: { toMillis?: () => number } }) =>
  typeof snap.readTime?.toMillis === "function" ? snap.readTime.toMillis() : Date.now();
const isLive = (r: RequestInstance) => !r.deletedAt && r.status !== "draft";

/**
 * 1 lượt đọc các đề xuất CÒN HIỆU LỰC (`deletedAt == null`; đo 06/10/2026: 35/230 đề
 * xuất, ~0,4 giây). Đường PHIÊN dùng.
 */
export async function loadLiveRequests(): Promise<LiveRequests> {
  const snap = await adminDb.collection("requests").where("deletedAt", "==", null).get();
  const requests = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as RequestInstance).filter(isLive);
  return { requests, readTimeMs: readMs(snap) };
}

/**
 * Đường SỰ KIỆN: chỉ đọc đề xuất feedCandidateRequests có thể cần — 3 truy vấn trên đề xuất
 * còn hiệu lực + đọc thẳng các id trong `keepIds`. `basedOn` lấy mốc đọc SỚM NHẤT trong các
 * lượt (an toàn cho phép chặn bản cũ đè bản mới).
 *
 * ⚠️ 2 truy vấn (deletedAt + updatedAt ≥, deletedAt + pendingAdjustment ≠) CẦN INDEX GHÉP
 * trong firestore.indexes.json (đã thử chỉ-đọc trên production 08/10/2026: thiếu index →
 * FAILED_PRECONDITION). Chưa deploy index thì rơi về đọc cả kho còn hiệu lực như đường
 * PHIÊN — vẫn đúng, chỉ chưa rẻ hơn.
 */
export async function loadCandidateRequests(keepIds: ReadonlySet<string>, now = Date.now()): Promise<LiveRequests> {
  const floor = new Date(now - READ_ENTRY_WINDOW_DAYS * 86_400_000).toISOString();
  const col = adminDb.collection("requests");
  const live = col.where("deletedAt", "==", null);
  let snaps;
  try {
    snaps = await Promise.all([
      live.where("updatedAt", ">=", floor).get(),
      live.where("status", "==", "pending").get(),
      live.where("pendingAdjustment", "!=", null).get(),
    ]);
  } catch (error) {
    if ((error as { code?: unknown })?.code !== 9) throw error;
    console.warn("Thiếu index ghép cho chuông (firestore.indexes.json) — tạm đọc cả kho còn hiệu lực.");
    return loadLiveRequests();
  }
  const byId = new Map<string, RequestInstance>();
  for (const s of snaps) for (const d of s.docs) byId.set(d.id, { id: d.id, ...d.data() } as RequestInstance);
  let readTimeMs = Math.min(...snaps.map(readMs));
  const missing = [...keepIds].filter((id) => id && !byId.has(id));
  if (missing.length > 0) {
    const docs = await adminDb.getAll(...missing.map((id) => col.doc(id)));
    for (const d of docs) if (d.exists) byId.set(d.id, { id: d.id, ...d.data() } as RequestInstance);
    readTimeMs = Math.min(readTimeMs, ...docs.map(readMs));
  }
  const requests = feedCandidateRequests([...byId.values()].filter(isLive), now, keepIds);
  return { requests, readTimeMs };
}

/**
 * Bộ nhớ dùng chung trong 1 lượt tính (1 sự kiện có thể tính lại cho ~15 người): mỗi
 * nhóm/quản lý trực tiếp/bình luận nhắc phòng ban chỉ tra 1 lần thay vì mỗi người 1 lần.
 */
export interface FeedRun extends LiveRequests {
  now: number;
  bypassManagers?: Promise<Map<string, string>>;
  groupMentionUids: Map<string, Promise<string[]>>;
}

function toRun(live: LiveRequests, now = Date.now()): FeedRun {
  return { ...live, now, groupMentionUids: new Map() };
}

export async function startFeedRun(): Promise<FeedRun> {
  return toRun(await loadLiveRequests());
}

/** Đề xuất → quản lý trực tiếp của người gửi, chỉ với đề xuất thuộc nhóm bật notifyManager
 * + có bước submitter_manager. Cùng luật với scope=manager-bypassed cũ. */
function bypassManagersOf(run: FeedRun): Promise<Map<string, string>> {
  run.bypassManagers ??= (async () => {
    const withGroup = run.requests.filter((r) => r.groupId);
    const groupIds = [...new Set(withGroup.map((r) => r.groupId!))];
    const groups = new Map<string, ProposalGroup | null>();
    await Promise.all(
      groupIds.map(async (id) => {
        const g = await adminDb.collection("groups").doc(id).get();
        groups.set(id, g.exists ? toProposalGroup(g.id, g.data()!) : null);
      }),
    );
    const eligible = withGroup.filter((r) => {
      const g = groups.get(r.groupId!);
      return g?.notifyManager && g.approverSteps.some((s) => s.kind === "submitter_manager");
    });
    const submitters = [...new Set(eligible.map((r) => r.submittedBy.uid))];
    const managers = new Map<string, string | null>();
    await Promise.all(submitters.map(async (s) => managers.set(s, await resolveDirectManagerId(s).catch(() => null))));
    const out = new Map<string, string>();
    for (const r of eligible) {
      const m = managers.get(r.submittedBy.uid);
      if (m) out.set(r.id, m);
    }
    return out;
  })();
  return run.bypassManagers;
}

/** Quản lý trực tiếp bị "qua mặt": quản lý của người gửi CHÍNH LÀ `uid` nhưng không có
 * trong approversSnapshot (và không phải chính người gửi). */
async function findBypassedRequestIds(run: FeedRun, uid: string): Promise<Set<string>> {
  const managers = await bypassManagersOf(run);
  return new Set(
    run.requests
      .filter((r) => managers.get(r.id) === uid && r.submittedBy.uid !== uid && !r.approversSnapshot.some((a) => a.id === uid))
      .map((r) => r.id),
  );
}

/** Bình luận gần đây nhắc tới `uid` QUA PHÒNG BAN (mentionIds là id phòng ban). Chỉ xét
 * bình luận trong cửa sổ hiển thị, đề xuất mà uid có trong `mentionedUids` (đã giãn sẵn
 * lúc tạo bình luận), và bình luận chưa nhắc thẳng uid — nên rất ít lượt tra. Kết quả
 * giãn của mỗi bình luận dùng chung cho mọi người trong cùng lượt tính. */
async function findGroupMentionCommentIds(run: FeedRun, uid: string): Promise<Set<string>> {
  const floor = new Date(run.now - READ_ENTRY_WINDOW_DAYS * 86_400_000).toISOString();
  const jobs: { id: string; mentionIds: string[]; author: string }[] = [];
  for (const r of run.requests) {
    if (!r.mentionedUids?.includes(uid)) continue;
    for (const c of r.comments ?? []) {
      if (c.at < floor || c.authorUid === uid || !c.mentionIds?.length || c.mentionIds.includes(uid)) continue;
      jobs.push({ id: c.id, mentionIds: c.mentionIds, author: c.authorUid });
    }
  }
  const out = new Set<string>();
  await Promise.all(
    jobs.map(async (j) => {
      let pending = run.groupMentionUids.get(j.id);
      if (!pending) {
        pending = expandMentionsToUids(j.mentionIds, j.author).catch(() => [] as string[]);
        run.groupMentionUids.set(j.id, pending);
      }
      if ((await pending).includes(uid)) out.add(j.id);
    }),
  );
  return out;
}

export interface FeedUser {
  uid: string;
  name: string;
  settings: NotificationSettings;
}

/** Tính danh sách của 1 người từ lượt đọc chung — không đọc lại kho đề xuất. */
export async function computeFeedFor(run: FeedRun, user: FeedUser): Promise<NotificationFeed> {
  const [bypassedRequestIds, groupMentionCommentIds] = await Promise.all([
    user.settings.manager_bypassed === false ? Promise.resolve(new Set<string>()) : findBypassedRequestIds(run, user.uid),
    user.settings.mentioned === false ? Promise.resolve(new Set<string>()) : findGroupMentionCommentIds(run, user.uid),
  ]);
  return buildNotificationFeed(run.requests, {
    uid: user.uid,
    name: user.name,
    settings: user.settings,
    now: run.now,
    bypassedRequestIds,
    groupMentionCommentIds,
  });
}

/** Tài liệu đã lưu còn dùng được để tính lại thay người đó (đúng phiên bản, đủ tên + cài đặt)? */
export function usableStoredFeed(data: unknown): data is StoredNotificationFeed {
  const d = data as Partial<StoredNotificationFeed> | undefined;
  return !!d && d.v === NOTIFICATION_FEED_VERSION && typeof d.uid === "string" && typeof d.name === "string" && !!d.settings;
}

const sameProfile = (a: Pick<FeedUser, "name" | "settings">, b: Partial<Pick<FeedUser, "name" | "settings">>) =>
  a.name === b.name && JSON.stringify(a.settings) === JSON.stringify(b.settings);

type WriteResult = "written" | "skipped" | "profile-changed";

/**
 * Ghi danh sách vào `notification-feed/{uid}` trong transaction:
 *  - Bản đang lưu tính từ dữ liệu MỚI HƠN (`basedOn` lớn hơn) → bỏ, không để bản tính
 *    cũ (2 sự kiện sát nhau, lượt chậm ghi sau) đè bản mới.
 *  - Đường SỰ KIỆN (`fromSession` = false): tên/cài đặt đang lưu KHÁC bản đã dùng để tính
 *    (người đó vừa đổi cài đặt giữa chừng) → không ghi, báo "profile-changed" để nơi gọi
 *    tính lại bằng bản mới; nội dung y hệt → không ghi; giữ nguyên `profileAt` cũ.
 *  - Đường PHIÊN: luôn ghi, đặt `profileAt` = bây giờ.
 */
async function writeFeed(user: FeedUser, feed: NotificationFeed, basedOn: number, fromSession: boolean): Promise<WriteResult> {
  const ref = feedCol().doc(user.uid);
  return adminDb.runTransaction(async (tx): Promise<WriteResult> => {
    const cur = await tx.get(ref);
    const old = cur.exists ? (cur.data() as Partial<StoredNotificationFeed>) : undefined;
    if (old && typeof old.basedOn === "number" && old.basedOn > basedOn) return "skipped";
    if (!fromSession) {
      if (!usableStoredFeed(old)) return "skipped";
      if (!sameProfile(user, old)) return "profile-changed";
      if (!old.stale && sameFeedContent(old, feed)) return "skipped";
    }
    const nowIso = new Date().toISOString();
    const doc: StoredNotificationFeed = {
      entries: feed.entries,
      badge: feed.badge,
      mustCount: feed.mustCount,
      trackedRequestIds: feed.trackedRequestIds ?? feed.entries.map((e) => e.requestId),
      v: NOTIFICATION_FEED_VERSION,
      uid: user.uid,
      name: user.name,
      settings: user.settings,
      requestIds: feed.entries.map((e) => e.requestId),
      basedOn,
      updatedAt: nowIso,
      profileAt: fromSession ? nowIso : (old?.profileAt ?? nowIso),
    };
    tx.set(ref, doc);
    return "written";
  });
}

/** Đánh dấu tài liệu "cần tính lại" khi lượt tính do sự kiện bị lỗi — client thấy sẽ gọi GET
 * 1 lần. Cố gắng hết mức, lỗi khi đánh dấu chỉ log. */
async function markStale(uids: string[]): Promise<void> {
  await Promise.all(
    uids.map((uid) =>
      feedCol()
        .doc(uid)
        .set({ stale: true }, { merge: true })
        .catch((error: unknown) => console.error(`Đánh dấu chuông ${uid} cần tính lại thất bại:`, error)),
    ),
  );
}

/**
 * Tính + ghi cho CHÍNH người đang đăng nhập (GET /api/notifications, "đánh dấu đã đọc
 * hết", đổi cài đặt thông báo). Đọc cả kho + cài đặt + tên mới nhất từ phiên/App Tổng nên
 * cũng là đường "làm tươi" tên và cài đặt lưu kèm tài liệu (`profileAt`).
 */
export async function computeAndStoreFeedForSession(session: { uid: string; name: string }): Promise<NotificationFeed> {
  const [run, settings] = await Promise.all([startFeedRun(), getNotificationSettings(session.uid)]);
  const user: FeedUser = { uid: session.uid, name: session.name, settings };
  const feed = await computeFeedFor(run, user);
  try {
    await writeFeed(user, feed, run.readTimeMs, true);
  } catch (error) {
    // Ghi hỏng thì vẫn trả danh sách cho người đang chờ — chuông vẫn hiện đúng.
    console.error("Ghi notification-feed thất bại (vẫn trả danh sách):", error);
  }
  const { trackedRequestIds: _bo, ...forClient } = feed;
  void _bo;
  return forClient;
}

/** Chỉ TÍNH (không ghi) cho người đang đăng nhập — dùng khi cần danh sách để làm việc khác. */
export async function loadNotificationFeed(session: { uid: string; name: string }): Promise<NotificationFeed> {
  const [run, settings] = await Promise.all([startFeedRun(), getNotificationSettings(session.uid)]);
  return computeFeedFor(run, { uid: session.uid, name: session.name, settings });
}

/** Tính lại cho 1 nhóm người ĐÃ CÓ tài liệu, dùng tên + cài đặt lưu sẵn. `extraKeep`: đề
 * xuất vừa có sự kiện (luôn đọc, kể cả khi không đổi updatedAt). */
async function refreshStoredUsers(uids: string[], extraKeep: string[]): Promise<number> {
  const unique = [...new Set(uids.filter(Boolean))];
  if (unique.length === 0) return 0;
  const snaps = await adminDb.getAll(...unique.map((u) => feedCol().doc(u)));
  const users: FeedUser[] = [];
  const keep = new Set<string>(extraKeep);
  for (const s of snaps) {
    const d = s.data();
    // Chưa có tài liệu / tài liệu bản cũ → bỏ qua; lần mở app tới, GET tự tính + ghi.
    if (!s.exists || !usableStoredFeed(d)) continue;
    users.push({ uid: s.id, name: d.name, settings: d.settings });
    for (const id of d.trackedRequestIds ?? d.requestIds ?? []) keep.add(id);
  }
  if (users.length === 0) return 0;
  let run: FeedRun;
  try {
    run = toRun(await loadCandidateRequests(keep));
  } catch (error) {
    console.error("Đọc đề xuất để tính lại chuông thất bại:", error);
    await markStale(users.map((u) => u.uid));
    return 0;
  }
  let written = 0;
  await Promise.all(
    users.map(async (u) => {
      try {
        let current = u;
        // Tối đa 2 lượt: lượt 2 khi người đó vừa đổi tên/cài đặt giữa chừng (tính lại bằng bản mới).
        for (let lan = 0; lan < 2; lan++) {
          const feed = await computeFeedFor(run, current);
          const kq = await writeFeed(current, feed, run.readTimeMs, false);
          if (kq === "written") written += 1;
          if (kq !== "profile-changed") return;
          const fresh = (await feedCol().doc(u.uid).get()).data();
          if (!usableStoredFeed(fresh)) return;
          current = { uid: u.uid, name: fresh.name, settings: fresh.settings };
        }
      } catch (error) {
        console.error(`Tính lại chuông cho ${u.uid} thất bại:`, error);
        await markStale([u.uid]);
      }
    }),
  );
  return written;
}

/** Những người cần tính lại khi đề xuất `requestId` đổi: ai CÓ THỂ có dòng của đề xuất
 * này sau thay đổi (vai trò trên đề xuất + quản lý trực tiếp nếu nhóm bật báo quản lý) ∪
 * ai ĐANG có dòng của nó (để gỡ khi họ không còn liên quan / đề xuất bị xoá). */
export async function affectedUidsForRequest(requestId: string): Promise<string[]> {
  const [reqSnap, holders] = await Promise.all([
    adminDb.collection("requests").doc(requestId).get(),
    feedCol().where("requestIds", "array-contains", requestId).select().get(),
  ]);
  const out = new Set<string>(holders.docs.map((d) => d.id));
  if (reqSnap.exists) {
    const r = { id: reqSnap.id, ...reqSnap.data() } as RequestInstance;
    if (isLive(r)) {
      for (const u of feedRecipientCandidates(r)) out.add(u);
      if (r.groupId) {
        const g = await adminDb.collection("groups").doc(r.groupId).get();
        const group = g.exists ? toProposalGroup(g.id, g.data()!) : null;
        if (group?.notifyManager && group.approverSteps.some((s) => s.kind === "submitter_manager")) {
          const m = await resolveDirectManagerId(r.submittedBy.uid).catch(() => null);
          if (m) out.add(m);
        }
      }
    }
  }
  return [...out];
}

/**
 * Gọi SAU KHI ghi `requests/{id}` thành công (trong `after()`), ở mọi chỗ trước đây gọi
 * bumpNotificationSignal + các chỗ đổi danh sách mà trước đây nhờ hỏi vòng mới thấy
 * (thêm người theo dõi, sửa/xoá bình luận, xoá/khôi phục đề xuất, lưu nháp khi bị trả lại).
 * Lỗi chỉ log (+ đánh dấu `stale` cho người đã biết) — không được làm hỏng thao tác chính.
 * Không vòng lặp: ghi `notification-feed` không kích hoạt gì ở máy chủ, trình duyệt
 * nhận về chỉ hiển thị, không ghi ngược.
 */
export async function refreshNotificationFeedsForRequest(requestId: string): Promise<void> {
  try {
    const uids = await affectedUidsForRequest(requestId);
    await refreshStoredUsers(uids, [requestId]);
  } catch (error) {
    console.error(`Tính lại chuông cho đề xuất ${requestId} thất bại:`, error);
  }
}

/**
 * Người dùng vừa mở 1 đề xuất (ghi `viewedAt[uid]`). Chỉ ảnh hưởng chính họ, và chỉ khi
 * đề xuất đó đang là dòng CHƯA ĐỌC trên chuông của họ (xem rồi chỉ có thể làm dòng hết
 * "chưa đọc", không thể làm dòng mới xuất hiện) — còn lại không tốn gì thêm.
 */
export async function refreshFeedAfterView(uid: string, requestId: string): Promise<void> {
  try {
    const snap = await feedCol().doc(uid).get();
    const d = snap.data();
    if (!snap.exists || !usableStoredFeed(d)) return;
    if (!d.entries.some((e) => e.requestId === requestId && e.unread)) return;
    await refreshStoredUsers([uid], [requestId]);
  } catch (error) {
    console.error(`Tính lại chuông sau khi xem đề xuất ${requestId} thất bại:`, error);
  }
}
