"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@base-ui-components/react/button";
import { Input } from "@base-ui-components/react/input";

type OAuthClientItem = {
  id: string;
  clientId: string;
  appName: string;
  loginDescription: string | null;
  redirectUris: string;
  scopes: string;
  trusted: boolean;
  status: string;
  allowedUserIds: string | null;
  createdAt?: string;
};

export default function AdminClientsPage() {
  const [users, setUsers] = useState<{ id: string; name: string; email: string; isDisabled: boolean }[]>([]);
  const [issuer, setIssuer] = useState("");
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState(false);
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>([]);
  const [status, setStatus] = useState("active");
  const [secretClientId, setSecretClientId] = useState("");
  const [items, setItems] = useState<OAuthClientItem[]>([]);
  const [scopeOptions, setScopeOptions] = useState<string[]>([
    "openid",
    "profile",
    "email",
  ]);
  const [error, setError] = useState<string | null>(null);
  const [latestSecret, setLatestSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rotatingClient, setRotatingClient] = useState<string | null>(null);
  const [form, setForm] = useState({
    appName: "",
    loginDescription: "",
    redirectUris: "",
    scopes: "openid profile email",
  });

  async function loadClients() {
    const response = await fetch("/api/admin/clients", { cache: "no-store" });
    if (!response.ok) {
      setError("加载应用接入列表失败，请确认管理员权限。");
      return;
    }
    const payload = (await response.json()) as { items: OAuthClientItem[]; issuer: string };
    setItems(payload.items);
    setIssuer(payload.issuer);
  }

  async function loadScopeOptions() {
    const response = await fetch("/api/admin/scopes", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { items: string[] };
    if (payload.items.length > 0) {
      setScopeOptions(payload.items);
    }
  }

  useEffect(() => {
    void Promise.all([
      loadClients(), loadScopeOptions(),
      fetch("/api/admin/users", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("users_unavailable");
        const payload = await response.json();
        setUsers(payload.items);
      }),
    ]).catch(() => setError("加载接入配置失败，请刷新后重试。"));
  }, []);

  /** 中文注释：将已有授权显式载入编辑表单，保存时才修改服务端配置。 */
  function editClient(item: OAuthClientItem) {
    setEditingClientId(item.clientId);
    setForm({ appName: item.appName, loginDescription: item.loginDescription ?? "", redirectUris: item.redirectUris.split(",").join("\n"), scopes: item.scopes });
    setAllUsers(item.allowedUserIds === null);
    try { setAllowedUserIds(item.allowedUserIds ? JSON.parse(item.allowedUserIds) : []); }
    catch { setAllowedUserIds([]); }
    setStatus(item.status);
    setLatestSecret(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingClientId(null);
    setForm({ appName: "", loginDescription: "", redirectUris: "", scopes: "openid profile email" });
    setAllUsers(false);
    setAllowedUserIds([]);
    setStatus("active");
  }

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.appName.localeCompare(b.appName)),
    [items],
  );

  async function createClient() {
    setCreating(true);
    setLatestSecret(null);
    setError(null);
    try {
      if (selectedScopes.length === 0) {
        setError("至少选择一个 scope。");
        return;
      }
      const response = await fetch("/api/admin/clients", {
        method: editingClientId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appName: form.appName,
          loginDescription: form.loginDescription,
          redirectUris: form.redirectUris,
          scopes: form.scopes,
          trusted: true,
          clientId: editingClientId,
          allowedUserIds: allUsers ? null : allowedUserIds,
          status,
        }),
      });

      if (!response.ok) {
        setError("保存失败，请检查回调地址、账号和权限；每行填写一个完整 HTTPS 回调地址。");
        return;
      }

      const payload = (await response.json()) as { clientSecret?: string; item: OAuthClientItem };
      setLatestSecret(payload.clientSecret ?? null);
      setSecretClientId(payload.item.clientId);
      resetForm();
      await loadClients();
    } catch {
      setError("网络异常，配置未确认保存，请刷新列表核对后重试。");
    } finally {
      setCreating(false);
    }
  }

  function toggleScope(scope: string) {
    setForm((prev) => {
      const current = prev.scopes
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
      const hasScope = current.includes(scope);
      const next = hasScope
        ? current.filter((item) => item !== scope)
        : [...current, scope];
      return {
        ...prev,
        scopes: next.join(" "),
      };
    });
  }

  const selectedScopes = useMemo(
    () =>
      form.scopes
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean),
    [form.scopes],
  );

  async function rotateSecret(clientId: string) {
    setRotatingClient(clientId);
    setLatestSecret(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/clients/${encodeURIComponent(clientId)}/rotate-secret`,
        { method: "POST" },
      );
      if (!response.ok) {
        setError("轮换 secret 失败。");
        return;
      }
      const payload = (await response.json()) as { clientSecret: string };
      setLatestSecret(payload.clientSecret);
      setSecretClientId(clientId);
      await loadClients();
    } finally {
      setRotatingClient(null);
    }
  }

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">应用接入管理</h1>
          <p className="admin-page-description">
            为各个系统配置统一登录、回调地址和允许访问的账号。
          </p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="admin-panel-header">
          <h2>{editingClientId ? "编辑接入应用" : "新建接入应用"}</h2>
        </div>
        <div className="admin-form-grid">
          <label className="admin-field">
            <span>应用名称</span>
            <Input
              value={form.appName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, appName: event.target.value }))
              }
              className="admin-input"
              placeholder="例如 StockMo、Promise Ledger"
            />
          </label>
          <label className="admin-field">
            <span>Scopes</span>
            <div className="admin-scope-list">
              {scopeOptions.map((scope) => (
                <label key={scope} className="admin-scope-item">
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  <span>{scope}</span>
                </label>
              ))}
            </div>
          </label>
          <label className="admin-field admin-field-full">
            <span>Redirect URIs（每行一个）</span>
            <textarea
              value={form.redirectUris}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, redirectUris: event.target.value }))
              }
              rows={4}
              className="admin-textarea"
            />
          </label>
          <label className="admin-field admin-field-full">
            <span>登录介绍（可选）</span>
            <textarea value={form.loginDescription} maxLength={500} rows={3} className="admin-textarea"
              placeholder="例如：浏览、整理与播放你的授权媒体。"
              onChange={(event) => setForm((prev) => ({ ...prev, loginDescription: event.target.value }))} />
            <span className="admin-muted">显示在统一登录和注册页，支持换行，最多 500 字符。留空使用默认介绍。</span>
          </label>
          <fieldset className="admin-field admin-field-full">
            <legend>允许访问的账号</legend>
            <label className="admin-scope-item">
              <input type="checkbox" checked={allUsers} onChange={(event) => setAllUsers(event.target.checked)} />
              <span>允许账号中心的所有用户</span>
            </label>
            {!allUsers ? <div className="admin-scope-list">
              {users.map((user) => <label key={user.id} className="admin-scope-item">
                <input type="checkbox" checked={allowedUserIds.includes(user.id)}
                  onChange={(event) => setAllowedUserIds((ids) => event.target.checked ? [...ids, user.id] : ids.filter((id) => id !== user.id))} />
                <span>{user.name || user.email} · {user.email}{user.isDisabled ? "（已禁用）" : ""}</span>
              </label>)}
              <p className="admin-muted">未选择账号时，任何人都无法登录此应用。撤销授权会阻止重新登录；业务系统须复核会话才能及时终止已有访问。</p>
            </div> : null}
          </fieldset>
          {editingClientId ? <label className="admin-field">
            <span>应用状态</span>
            <select className="admin-input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">启用</option><option value="disabled">停用</option>
            </select>
          </label> : null}
          <div className="admin-actions-row">
            <Button
              className="admin-btn admin-btn-primary"
              onClick={createClient}
              disabled={creating}
            >
              {creating ? "保存中..." : editingClientId ? "保存修改" : "创建接入"}
            </Button>
            {editingClientId ? <Button className="admin-btn" onClick={resetForm}>取消编辑</Button> : null}
          </div>
        </div>
        {latestSecret ? (
          <div className="admin-secret-box">
            <p>接入参数（Secret 只展示一次，请立即保存）</p>
            <p>Issuer：<code>{issuer}</code></p>
            <p>Client ID：<code>{secretClientId}</code></p>
            <code>{latestSecret}</code>
          </div>
        ) : null}
        {error ? <p className="admin-alert">{error}</p> : null}
      </section>

      <section className="admin-panel">
        <div className="admin-panel-header">
          <h2>已接入应用</h2>
        </div>
        <p className="admin-muted">
          出于安全考虑，当前 Secret 仅在创建/轮换时展示一次，历史明文不可回看。
        </p>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>应用</th>
                <th>Client ID</th>
                <th>Redirect URIs</th>
                <th>Scopes</th>
                <th>访问范围</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.appName}</td>
                  <td>
                    <code>{item.clientId}</code>
                  </td>
                  <td>
                    <code>{item.redirectUris}</code>
                  </td>
                  <td>{item.scopes}</td>
                  <td>{item.status !== "active" ? "已停用" : item.allowedUserIds === null ? "全部账号" : "仅授权账号"}</td>
                  <td>
                    <Button className="admin-btn" onClick={() => editClient(item)}>编辑配置</Button>
                    <Button
                      className="admin-btn"
                      onClick={() => rotateSecret(item.clientId)}
                      disabled={rotatingClient === item.clientId}
                    >
                      {rotatingClient === item.clientId ? "轮换中..." : "轮换 Secret"}
                    </Button>
                  </td>
                </tr>
              ))}
              {sortedItems.length === 0 ? (
                <tr>
                  <td className="admin-empty" colSpan={6}>
                    暂无接入应用
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
