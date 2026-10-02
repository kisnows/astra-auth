"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@base-ui-components/react/input";

type AuditLog = {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
  createdAt: string;
};

export default function AdminAuditsPage() {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/admin/audits", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { items: AuditLog[] };
      setItems(payload.items);
    })();
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => {
      return (
        item.action.toLowerCase().includes(keyword) ||
        item.targetType.toLowerCase().includes(keyword) ||
        item.targetId.toLowerCase().includes(keyword) ||
        item.actorUserId.toLowerCase().includes(keyword)
      );
    });
  }, [items, search]);

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">审计日志</h1>
          <p className="admin-page-description">
            所有管理操作会在此落库，便于排障与安全审计。
          </p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="admin-panel-header">
          <h2>筛选</h2>
        </div>
        <Input
          className="admin-input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="按 action / target / actor 过滤"
        />
      </section>

      <section className="admin-panel">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>
                    <code>{item.actorUserId}</code>
                  </td>
                  <td>{item.action}</td>
                  <td>
                    {item.targetType}:{item.targetId}
                  </td>
                  <td>
                    <code>{item.detail || ""}</code>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-empty">
                    暂无日志
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
