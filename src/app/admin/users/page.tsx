"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@base-ui-components/react/button";
import { Input } from "@base-ui-components/react/input";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  isDisabled: boolean;
  isAdmin?: boolean;
  mustChangePassword?: boolean;
};

type UserAccountBinding = {
  id: string;
  providerId: string;
  accountId: string;
  scope: string | null;
  createdAt: string;
  updatedAt: string;
};

type UserSession = {
  id: string;
  expiresAt: string;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
};

type UserDetail = AdminUser & {
  createdAt: string;
  updatedAt: string;
  accounts: UserAccountBinding[];
  sessions: UserSession[];
};

type AdminRoleConfirmState = {
  user: AdminUser;
  action: "grant" | "revoke";
} | null;

const MAX_USER_NAME_LENGTH = 64;

export default function AdminUsersPage() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editName, setEditName] = useState("");
  const [newPassword, setNewPassword] = useState("demodemodemo");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [adminRoleConfirm, setAdminRoleConfirm] =
    useState<AdminRoleConfirmState>(null);

  // 中文注释：统一加载用户列表，供筛选、操作与详情刷新复用。
  async function loadUsers() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    if (!response.ok) {
      setError("加载用户失败");
      return;
    }
    const payload = (await response.json()) as { items: AdminUser[] };
    setItems(payload.items);
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => {
      return (
        item.email.toLowerCase().includes(keyword) ||
        item.name.toLowerCase().includes(keyword) ||
        item.id.toLowerCase().includes(keyword)
      );
    });
  }, [items, search]);

  async function openDetail(userId: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/detail`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setError("加载用户详情失败");
        return;
      }
      const payload = (await response.json()) as { item: UserDetail };
      setDetail(payload.item);
    } finally {
      setDetailLoading(false);
    }
  }

  async function toggleUser(user: AdminUser) {
    setPendingUserId(user.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDisabled: !user.isDisabled }),
      });
      if (!response.ok) {
        setError("更新用户状态失败");
        return;
      }
      await loadUsers();
      if (detail?.id === user.id) {
        await openDetail(user.id);
      }
    } finally {
      setPendingUserId(null);
    }
  }

  async function confirmToggleAdminRole() {
    if (!adminRoleConfirm) return;
    const user = adminRoleConfirm.user;
    setPendingUserId(user.id);
    setError(null);
    try {
      const method = user.isAdmin ? "DELETE" : "POST";
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(user.id)}/admin-role`,
        { method },
      );
      if (!response.ok) {
        setError("更新管理员角色失败");
        return;
      }
      setAdminRoleConfirm(null);
      await loadUsers();
      if (detail?.id === user.id) {
        await openDetail(user.id);
      }
    } finally {
      setPendingUserId(null);
    }
  }

  // 中文注释：进入编辑模式时预填当前用户名，避免管理员重复输入。
  function beginEditUserName(user: AdminUser) {
    setError(null);
    setResetTarget(null);
    setEditTarget(user);
    setEditName(user.name || "");
  }

  // 中文注释：提交管理员改名请求，成功后刷新列表与详情抽屉数据。
  async function updateUserName() {
    if (!editTarget) return;
    const normalizedName = editName.trim();
    if (normalizedName.length > MAX_USER_NAME_LENGTH) {
      setError(`名称长度不能超过 ${MAX_USER_NAME_LENGTH} 个字符`);
      return;
    }

    setPendingUserId(editTarget.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(editTarget.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: normalizedName }),
        },
      );
      if (!response.ok) {
        setError("更新用户名称失败");
        return;
      }

      const targetId = editTarget.id;
      setEditTarget(null);
      setEditName("");
      await loadUsers();
      if (detail?.id === targetId) {
        await openDetail(targetId);
      }
    } finally {
      setPendingUserId(null);
    }
  }

  async function resetPassword() {
    if (!resetTarget) return;
    if (newPassword.length < 8) {
      setError("新密码长度至少 8 位");
      return;
    }

    setPendingUserId(resetTarget.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(resetTarget.id)}/reset-password`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ newPassword }),
        },
      );
      if (!response.ok) {
        setError("密码重置失败");
        return;
      }
      setResetTarget(null);
      setNewPassword("demodemodemo");
      await loadUsers();
      if (detail?.id === resetTarget.id) {
        await openDetail(resetTarget.id);
      }
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <>
      <main className="admin-page">
        <header className="admin-page-header">
          <div>
            <h1 className="admin-page-title">用户管理</h1>
            <p className="admin-page-description">
              支持用户名称修改、状态管理、管理员权限授权与临时密码重置。
            </p>
          </div>
        </header>

        <section className="admin-panel">
          <div className="admin-panel-header">
            <h2>查询用户</h2>
          </div>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="admin-input"
            placeholder="输入邮箱 / 昵称 / User ID"
          />
        </section>

        {resetTarget ? (
          <section className="admin-panel">
            <div className="admin-panel-header">
              <h2>重置为临时密码</h2>
            </div>
            <p className="admin-muted">目标用户：{resetTarget.email}</p>
            <p className="admin-muted">
              重置后该用户会被要求首次登录立即修改密码。
            </p>
            <div className="admin-form-grid">
              <label className="admin-field">
                <span>临时密码</span>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="admin-input"
                  placeholder="至少 8 位"
                />
              </label>
              <div className="admin-actions-row">
                <Button
                  className="admin-btn admin-btn-primary"
                  onClick={resetPassword}
                  disabled={pendingUserId === resetTarget.id}
                >
                  {pendingUserId === resetTarget.id ? "重置中..." : "确认重置"}
                </Button>
                <Button className="admin-btn" onClick={() => setResetTarget(null)}>
                  取消
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {editTarget ? (
          <section className="admin-panel">
            <div className="admin-panel-header">
              <h2>修改用户名称</h2>
            </div>
            <p className="admin-muted">目标用户：{editTarget.email}</p>
            <div className="admin-form-grid">
              <label className="admin-field">
                <span>名称</span>
                <Input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  className="admin-input"
                  placeholder="最多 64 个字符"
                />
              </label>
              <div className="admin-actions-row">
                <Button
                  className="admin-btn admin-btn-primary"
                  onClick={updateUserName}
                  disabled={pendingUserId === editTarget.id}
                >
                  {pendingUserId === editTarget.id ? "保存中..." : "保存"}
                </Button>
                <Button
                  className="admin-btn"
                  onClick={() => {
                    setEditTarget(null);
                    setEditName("");
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {error ? <p className="admin-alert">{error}</p> : null}

        <section className="admin-panel">
          <div className="admin-panel-header">
            <h2>用户列表</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>改密策略</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>{item.email}</td>
                    <td>{item.name || "-"}</td>
                    <td>{item.isDisabled ? "disabled" : "active"}</td>
                    <td>{item.isAdmin ? "admin" : "user"}</td>
                    <td>{item.mustChangePassword ? "首次登录强制改密" : "正常"}</td>
                    <td>
                      <div className="admin-row-actions">
                        <Button
                          className="admin-btn"
                          onClick={() => openDetail(item.id)}
                          disabled={pendingUserId === item.id}
                        >
                          详情
                        </Button>
                        <Button
                          className="admin-btn"
                          onClick={() => toggleUser(item)}
                          disabled={pendingUserId === item.id}
                        >
                          {item.isDisabled ? "启用" : "禁用"}
                        </Button>
                        <Button
                          className="admin-btn"
                          onClick={() =>
                            setAdminRoleConfirm({
                              user: item,
                              action: item.isAdmin ? "revoke" : "grant",
                            })
                          }
                          disabled={pendingUserId === item.id}
                        >
                          {item.isAdmin ? "撤销管理员" : "授予管理员"}
                        </Button>
                        <Button
                          className="admin-btn"
                          onClick={() => {
                            setEditTarget(null);
                            setEditName("");
                            setResetTarget(item);
                          }}
                          disabled={pendingUserId === item.id}
                        >
                          临时密码重置
                        </Button>
                        <Button
                          className="admin-btn"
                          onClick={() => beginEditUserName(item)}
                          disabled={pendingUserId === item.id}
                        >
                          修改名称
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredItems.length === 0 ? (
                  <tr>
                    <td className="admin-empty" colSpan={6}>
                      没有符合条件的用户
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <aside className={`admin-drawer ${detailOpen ? "open" : ""}`}>
        <div className="admin-drawer-header">
          <h2>用户详情</h2>
          <Button className="admin-btn" onClick={() => setDetailOpen(false)}>
            关闭
          </Button>
        </div>
        {detailLoading ? <p className="admin-muted">加载中...</p> : null}
        {!detailLoading && !detail ? (
          <p className="admin-muted">请选择用户查看详情</p>
        ) : null}
        {detail ? (
          <div className="admin-drawer-body">
            <div className="admin-detail-grid">
              <p>
                <strong>Email:</strong> {detail.email}
              </p>
              <p>
                <strong>User ID:</strong> <code>{detail.id}</code>
              </p>
              <p>
                <strong>状态:</strong> {detail.isDisabled ? "disabled" : "active"}
              </p>
              <p>
                <strong>角色:</strong> {detail.isAdmin ? "admin" : "user"}
              </p>
              <p>
                <strong>密码策略:</strong>{" "}
                {detail.mustChangePassword ? "首次登录强制改密" : "正常"}
              </p>
            </div>

            <section className="admin-panel">
              <div className="admin-panel-header">
                <h2>账号绑定</h2>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Account ID</th>
                      <th>Scope</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.accounts.map((account) => (
                      <tr key={account.id}>
                        <td>{account.providerId}</td>
                        <td>
                          <code>{account.accountId}</code>
                        </td>
                        <td>{account.scope || "-"}</td>
                        <td>{new Date(account.updatedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                    {detail.accounts.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="admin-empty">
                          暂无账号绑定
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-panel">
              <div className="admin-panel-header">
                <h2>有效会话</h2>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Session ID</th>
                      <th>IP</th>
                      <th>UA</th>
                      <th>过期时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sessions.map((session) => (
                      <tr key={session.id}>
                        <td>
                          <code>{session.id}</code>
                        </td>
                        <td>{session.ipAddress || "-"}</td>
                        <td>{session.userAgent || "-"}</td>
                        <td>{new Date(session.expiresAt).toLocaleString()}</td>
                      </tr>
                    ))}
                    {detail.sessions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="admin-empty">
                          当前无会话
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </aside>
      {detailOpen ? <div className="admin-drawer-mask" onClick={() => setDetailOpen(false)} /> : null}
      {adminRoleConfirm ? (
        <div className="admin-confirm-overlay">
          <section className="admin-confirm-modal">
            <h3>二次确认</h3>
            <p>
              {adminRoleConfirm.action === "grant"
                ? `确认授予 ${adminRoleConfirm.user.email} 管理员权限？`
                : `确认撤销 ${adminRoleConfirm.user.email} 的管理员权限？`}
            </p>
            <div className="admin-actions-row">
              <Button
                className="admin-btn admin-btn-primary"
                onClick={confirmToggleAdminRole}
                disabled={pendingUserId === adminRoleConfirm.user.id}
              >
                {pendingUserId === adminRoleConfirm.user.id ? "处理中..." : "确认"}
              </Button>
              <Button
                className="admin-btn"
                onClick={() => setAdminRoleConfirm(null)}
              >
                取消
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
