"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import DatePicker from "@/components/ui/DatePicker";
import type { ListLoadStatus, RequestInstance } from "@/lib/types";

export default function ReportsPage() {
  return (
    <RequireAdminRole>
      <ReportsPageInner />
    </RequireAdminRole>
  );
}

interface GroupStat {
  key: string;
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  overdueRate: number;
  medianHours: number | null;
}

interface ApproverStat {
  name: string;
  approved: number;
  rejected: number;
  total: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeStat(key: string, requests: RequestInstance[]): GroupStat {
  const total = requests.length;
  const approved = requests.filter((r) => r.status === "approved").length;
  const rejected = requests.filter((r) => r.status === "rejected").length;
  const pending = requests.filter((r) => r.status === "pending").length;
  const pendingOnes = requests.filter((r) => r.status === "pending");
  const overdueCount = pendingOnes.filter(
    (r) => r.deadlineAt && new Date(r.deadlineAt).getTime() < Date.now(),
  ).length;
  const overdueRate = pendingOnes.length > 0 ? (overdueCount / pendingOnes.length) * 100 : 0;
  const durations = requests
    .filter((r) => r.status === "approved" || r.status === "rejected")
    .map((r) => (new Date(r.updatedAt ?? r.submittedAt).getTime() - new Date(r.submittedAt).getTime()) / 3600000);
  const medianHours = median(durations);
  return { key, total, approved, rejected, pending, overdueRate, medianHours };
}

function toCsvValue(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const content = rows.map((row) => row.map(toCsvValue).join(",")).join("\n");
  const blob = new Blob([`﻿${content}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportsPageInner() {
  const [requests, setRequests] = useState<RequestInstance[]>([]);
  const [status, setStatus] = useState<ListLoadStatus>("loading");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [approverFilter, setApproverFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    fetch("/api/requests?scope=system")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { requests: RequestInstance[] }) => {
        const nonDeleted = (data.requests ?? []).filter((r) => !r.deletedAt && r.status !== "draft");
        setRequests(nonDeleted);
        setStatus("loaded");
      })
      .catch(() => setStatus("error"));
  }, []);

  const groupNames = useMemo(
    () => Array.from(new Set(requests.map((r) => r.groupNameSnapshot))).sort(),
    [requests],
  );
  const approverNames = useMemo(() => {
    const names = new Set<string>();
    requests.forEach((r) => r.approversSnapshot.forEach((a) => names.add(a.name)));
    return Array.from(names).sort();
  }, [requests]);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (dateFrom && r.submittedAt < dateFrom) return false;
      if (dateTo && r.submittedAt > `${dateTo}T23:59:59`) return false;
      if (groupFilter && r.groupNameSnapshot !== groupFilter) return false;
      if (creatorFilter && !r.submittedBy.name.toLowerCase().includes(creatorFilter.toLowerCase())) return false;
      if (approverFilter && !r.approversSnapshot.some((a) => a.name === approverFilter)) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
  }, [requests, dateFrom, dateTo, groupFilter, creatorFilter, approverFilter, statusFilter]);

  const overall = useMemo(() => computeStat("all", filtered), [filtered]);

  const byGroup = useMemo(() => {
    const groups = new Map<string, RequestInstance[]>();
    filtered.forEach((r) => {
      const list = groups.get(r.groupNameSnapshot) ?? [];
      list.push(r);
      groups.set(r.groupNameSnapshot, list);
    });
    return Array.from(groups.entries())
      .map(([name, list]) => computeStat(name, list))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  const byApprover = useMemo(() => {
    const stats = new Map<string, ApproverStat>();
    filtered.forEach((r) => {
      r.history.forEach((h) => {
        if (h.action !== "Đã chấp thuận" && h.action !== "Đã từ chối") return;
        const current = stats.get(h.actor) ?? { name: h.actor, approved: 0, rejected: 0, total: 0 };
        if (h.action === "Đã chấp thuận") current.approved += 1;
        else current.rejected += 1;
        current.total += 1;
        stats.set(h.actor, current);
      });
    });
    return Array.from(stats.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const monthlyCounts = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((r) => {
      const month = r.submittedAt.slice(0, 7);
      map.set(month, (map.get(month) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);
  const maxMonthly = Math.max(1, ...monthlyCounts.map(([, count]) => count));

  const exportExcel = () => {
    const rows: (string | number)[][] = [
      ["Mã", "Nhóm đề xuất", "Người tạo", "Trạng thái", "Thời gian gửi", "Cập nhật gần nhất"],
      ...filtered.map((r) => [
        r.code ?? r.id,
        r.groupNameSnapshot,
        r.submittedBy.name,
        r.status,
        new Date(r.submittedAt).toLocaleString("vi-VN"),
        new Date(r.updatedAt ?? r.submittedAt).toLocaleString("vi-VN"),
      ]),
    ];
    downloadCsv(`bao-cao-de-xuat-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="px-8 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[23px] font-bold text-gray-900">Báo cáo</h1>
          <p className="mt-1 text-[13px] text-gray-500">
            Thống kê đề xuất theo bộ lọc bên dưới — không tính nháp và đề xuất đã xóa.
          </p>
        </div>
        <button
          type="button"
          onClick={exportExcel}
          disabled={filtered.length === 0}
          className="flex h-9 items-center gap-1.5 rounded bg-[var(--color-action-blue)] px-4 text-[13px] font-medium text-white hover:brightness-95 disabled:opacity-50"
        >
          <Download size={15} /> Xuất Excel (.csv)
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 rounded-[3px] border border-[var(--color-border)] bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className="mb-1 block text-[11px] text-gray-400">Từ ngày</label>
          <DatePicker
            value={dateFrom}
            onChange={setDateFrom}
            className="h-8 w-full rounded border border-[var(--color-border)] px-2 text-left text-[12px] outline-none focus:border-[var(--color-action-blue)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-400">Đến ngày</label>
          <DatePicker
            value={dateTo}
            onChange={setDateTo}
            className="h-8 w-full rounded border border-[var(--color-border)] px-2 text-left text-[12px] outline-none focus:border-[var(--color-action-blue)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-400">Nhóm đề xuất</label>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="h-8 w-full rounded border border-[var(--color-border)] px-2 text-[12px] outline-none focus:border-[var(--color-action-blue)]"
          >
            <option value="">Tất cả</option>
            {groupNames.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-400">Người tạo</label>
          <input
            value={creatorFilter}
            onChange={(e) => setCreatorFilter(e.target.value)}
            placeholder="Tìm tên"
            className="h-8 w-full rounded border border-[var(--color-border)] px-2 text-[12px] outline-none focus:border-[var(--color-action-blue)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-400">Người duyệt</label>
          <select
            value={approverFilter}
            onChange={(e) => setApproverFilter(e.target.value)}
            className="h-8 w-full rounded border border-[var(--color-border)] px-2 text-[12px] outline-none focus:border-[var(--color-action-blue)]"
          >
            <option value="">Tất cả</option>
            {approverNames.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-400">Trạng thái</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 w-full rounded border border-[var(--color-border)] px-2 text-[12px] outline-none focus:border-[var(--color-action-blue)]"
          >
            <option value="">Tất cả</option>
            <option value="pending">Đang chờ duyệt</option>
            <option value="approved">Đã chấp thuận</option>
            <option value="rejected">Đã từ chối</option>
            <option value="returned">Đã trả lại</option>
          </select>
        </div>
      </div>

      {status === "loading" && <p className="mt-6 text-[13px] text-gray-400">Đang tải...</p>}
      {status === "error" && (
        <p className="mt-6 text-[13px] text-[var(--color-danger-red)]">Không tải được dữ liệu báo cáo.</p>
      )}

      {status === "loaded" && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Tổng số đề xuất" value={overall.total} />
            <StatCard label="Đã chấp thuận" value={overall.approved} accent="text-[var(--color-confirm-green)]" />
            <StatCard label="Đã từ chối" value={overall.rejected} accent="text-[var(--color-danger-red)]" />
            <StatCard label="Đang xử lý" value={overall.pending} accent="text-amber-600" />
            <StatCard label="Tỷ lệ quá hạn" value={`${overall.overdueRate.toFixed(0)}%`} />
            <StatCard
              label="Xử lý trung vị"
              value={overall.medianHours !== null ? `${overall.medianHours.toFixed(1)}h` : "—"}
            />
          </div>

          <div className="mt-6 rounded-[3px] border border-[var(--color-border)] bg-white p-4">
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-gray-500">
              Số đề xuất theo tháng
            </h2>
            {monthlyCounts.length === 0 ? (
              <p className="text-[13px] text-gray-400">Không có dữ liệu.</p>
            ) : (
              <div className="flex h-[140px] items-end gap-3 overflow-x-auto">
                {monthlyCounts.map(([month, count]) => (
                  <div key={month} className="flex w-12 shrink-0 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-[var(--color-action-blue)]"
                      style={{ height: `${Math.max(4, (count / maxMonthly) * 100)}px` }}
                      title={`${count} đề xuất`}
                    />
                    <span className="text-[10px] text-gray-400">{month.slice(5)}</span>
                    <span className="text-[10px] font-medium text-gray-600">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 rounded-[3px] border border-[var(--color-border)] bg-white p-4">
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-gray-500">
              Theo nhóm đề xuất
            </h2>
            {byGroup.length === 0 ? (
              <p className="text-[13px] text-gray-400">Không có dữ liệu.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-left text-[12px] text-gray-400">
                  <tr>
                    <th className="py-1.5 font-medium">Nhóm</th>
                    <th className="py-1.5 font-medium">Tổng</th>
                    <th className="py-1.5 font-medium">Đã duyệt</th>
                    <th className="py-1.5 font-medium">Từ chối</th>
                    <th className="py-1.5 font-medium">Đang xử lý</th>
                    <th className="py-1.5 font-medium">Quá hạn</th>
                    <th className="py-1.5 font-medium">Trung vị (giờ)</th>
                  </tr>
                </thead>
                <tbody>
                  {byGroup.map((g) => (
                    <tr key={g.key} className="border-t border-gray-100">
                      <td className="py-2 font-medium text-gray-800">{g.key}</td>
                      <td className="py-2">{g.total}</td>
                      <td className="py-2 text-[var(--color-confirm-green)]">{g.approved}</td>
                      <td className="py-2 text-[var(--color-danger-red)]">{g.rejected}</td>
                      <td className="py-2 text-amber-600">{g.pending}</td>
                      <td className="py-2">{g.overdueRate.toFixed(0)}%</td>
                      <td className="py-2">{g.medianHours !== null ? g.medianHours.toFixed(1) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="mt-6 rounded-[3px] border border-[var(--color-border)] bg-white p-4">
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-gray-500">
              Theo người duyệt
            </h2>
            <p className="mb-2 text-[11px] text-gray-400">
              Đã xử lý = số lần chấp thuận/từ chối tra theo lịch sử hoạt động.
            </p>
            {byApprover.length === 0 ? (
              <p className="text-[13px] text-gray-400">Không có dữ liệu.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-left text-[12px] text-gray-400">
                  <tr>
                    <th className="py-1.5 font-medium">Người duyệt</th>
                    <th className="py-1.5 font-medium">Đã xử lý</th>
                    <th className="py-1.5 font-medium">Đã chấp thuận</th>
                    <th className="py-1.5 font-medium">Đã từ chối</th>
                  </tr>
                </thead>
                <tbody>
                  {byApprover.map((a) => (
                    <tr key={a.name} className="border-t border-gray-100">
                      <td className="py-2 font-medium text-gray-800">{a.name}</td>
                      <td className="py-2">{a.total}</td>
                      <td className="py-2 text-[var(--color-confirm-green)]">{a.approved}</td>
                      <td className="py-2 text-[var(--color-danger-red)]">{a.rejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="rounded-[3px] border border-[var(--color-border)] bg-white p-3">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className={`mt-1 text-[20px] font-bold ${accent ?? "text-gray-900"}`}>{value}</p>
    </div>
  );
}
