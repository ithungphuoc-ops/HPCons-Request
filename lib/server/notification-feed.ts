import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import {
  buildNotificationFeed,
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
 */

const feedCol = () => adminDb.collection(NOTIFICATION_FEED_COLLECTION);

interface LiveRequests {
  requests: RequestInstance[];
  /** Thời điểm Firestore đọc kho (ms) — mốc `basedOn` của mọi bản tính từ lượt đọc này. */
  readTimeMs: number;
}

/**
 * 1 lượt đọc các đề xuất CÒN HIỆU LỰC (`deletedAt == null`; đo 06/10/2026: 35/230 đề
 * xuất, ~0,4 giây). Dùng chung cho mọi người được tính lại trong cùng 1 sự kiện.
 */
export async function loadLiveRequests(): Promise<LiveRequests> {
  const snap = await adminDb.collection("requests").where("deletedAt", "==", null).get();
  const requests = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as RequestInstance).filter((r) => r.status !== "draft");
  const readTimeMs = typeof snap.readTime?.toMillis === "function" ? snap.readTime.toMillis() : Date.now();
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

export async function startFeedRun(): Promise<FeedRun> {
  const live = await loadLiveRequests();
  return { ...live, now: Date.now(), groupMentionUids: new Map() };
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

/**
 * Ghi danh sách vào `notification-feed/{uid}` trong transaction:
 *  - Bản đang lưu tính từ dữ liệu MỚI HƠN (`basedOn` lớn hơn) → bỏ, không để bản tính
 *    cũ (2 sự kiện sát nhau, lượt chậm ghi sau) đè bản mới.
 *  - `skipIfSame`: nội dung y hệt → không ghi (sự kiện) — GET thì vẫn ghi để làm mới
 *    `updatedAt` (client dựa vào đó biết tài liệu còn "tươi").
 * Trả về true nếu đã ghi.
 */
async function writeFeed(user: FeedUser, feed: NotificationFeed, basedOn: number, skipIfSame: boolean): Promise<boolean> {
  const ref = feedCol().doc(user.uid);
  return adminDb.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const old = cur.exists ? (cur.data() as Partial<StoredNotificationFeed>) : undefined;
    if (old && typeof old.basedOn === "number" && old.basedOn > basedOn) return false;
    if (
      skipIfSame &&
      usableStoredFeed(old) &&
      old.name === user.name &&
      JSON.stringify(old.settings) === JSON.stringify(user.settings) &&
      sameFeedContent(old, feed)
    ) {
      return false;
    }
    const doc: StoredNotificationFeed = {
      ...feed,
      v: NOTIFICATION_FEED_VERSION,
      uid: user.uid,
      name: user.name,
      settings: user.settings,
      requestIds: feed.entries.map((e) => e.requestId),
      basedOn,
      updatedAt: new Date().toISOString(),
    };
    tx.set(ref, doc);
    return true;
  });
}

/**
 * Tính + ghi cho CHÍNH người đang đăng nhập (GET /api/notifications, "đánh dấu đã đọc
 * hết", đổi cài đặt thông báo). Đọc cài đặt + tên mới nhất từ phiên/App Tổng nên cũng là
 * đường "làm tươi" tên và cài đặt lưu kèm tài liệu.
 */
export async function computeAndStoreFeedForSession(session: { uid: string; name: string }): Promise<NotificationFeed> {
  const [run, settings] = await Promise.all([startFeedRun(), getNotificationSettings(session.uid)]);
  const user: FeedUser = { uid: session.uid, name: session.name, settings };
  const feed = await computeFeedFor(run, user);
  try {
    await writeFeed(user, feed, run.readTimeMs, false);
  } catch (error) {
    // Ghi hỏng thì vẫn trả danh sách cho người đang chờ — chuông vẫn hiện đúng.
    console.error("Ghi notification-feed thất bại (vẫn trả danh sách):", error);
  }
  return feed;
}

/** Chỉ TÍNH (không ghi) cho người đang đăng nhập — dùng khi cần danh sách để làm việc khác. */
export async function loadNotificationFeed(session: { uid: string; name: string }): Promise<NotificationFeed> {
  const [run, settings] = await Promise.all([startFeedRun(), getNotificationSettings(session.uid)]);
  return computeFeedFor(run, { uid: session.uid, name: session.name, settings });
}

/** Tính lại cho 1 nhóm người ĐÃ CÓ tài liệu, dùng tên + cài đặt lưu sẵn. */
async function refreshStoredUsers(uids: string[]): Promise<number> {
  const unique = [...new Set(uids.filter(Boolean))];
  if (unique.length === 0) return 0;
  const snaps = await adminDb.getAll(...unique.map((u) => feedCol().doc(u)));
  const users: FeedUser[] = [];
  for (const s of snaps) {
    const d = s.data();
    // Chưa có tài liệu / tài liệu bản cũ → bỏ qua; lần mở app tới, GET tự tính + ghi.
    if (!s.exists || !usableStoredFeed(d)) continue;
    users.push({ uid: s.id, name: d.name, settings: d.settings });
  }
  if (users.length === 0) return 0;
  const run = await startFeedRun();
  let written = 0;
  await Promise.all(
    users.map(async (u) => {
      try {
        const feed = await computeFeedFor(run, u);
        if (await writeFeed(u, feed, run.readTimeMs, true)) written += 1;
      } catch (error) {
        console.error(`Tính lại chuông cho ${u.uid} thất bại:`, error);
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
    if (!r.deletedAt && r.status !== "draft") {
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
 * (thêm người theo dõi, sửa/xoá bình luận, xoá/khôi phục đề xuất). Lỗi chỉ log — không
 * được làm hỏng thao tác chính; người bị lỡ sẽ được tính lại ở sự kiện sau hoặc khi
 * tài liệu quá hạn (client gọi GET).
 * Không vòng lặp: ghi `notification-feed` không kích hoạt gì ở máy chủ, trình duyệt
 * nhận về chỉ hiển thị, không ghi ngược.
 */
export async function refreshNotificationFeedsForRequest(requestId: string): Promise<void> {
  try {
    const uids = await affectedUidsForRequest(requestId);
    await refreshStoredUsers(uids);
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
    await refreshStoredUsers([uid]);
  } catch (error) {
    console.error(`Tính lại chuông sau khi xem đề xuất ${requestId} thất bại:`, error);
  }
}
