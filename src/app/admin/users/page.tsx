"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@base-ui-components/react/button";
import { Input } from "@base-ui-components/react/input";
import { Dialog } from "@base-ui-components/react/dialog";
import { Menu } from "@base-ui-components/react/menu";
import {
  ArrowTopRightIcon, CheckCircledIcon, Cross2Icon, DotsHorizontalIcon,
  ExclamationTriangleIcon, LockClosedIcon, MagnifyingGlassIcon,
  Pencil1Icon, PersonIcon, ReloadIcon,
} from "@radix-ui/react-icons";
import "./admin-users.css";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  isDisabled: boolean;
  isAdmin?: boolean;
  mustChangePassword?: boolean;
};
type UserDetail = AdminUser & {
  createdAt: string;
  updatedAt: string;
  accounts: {
    id: string; providerId: string; accountId: string; scope: string | null;
    createdAt: string; updatedAt: string;
  }[];
  sessions: {
    id: string; expiresAt: string; createdAt: string;
    ipAddress: string | null; userAgent: string | null;
  }[];
};
type Operation =
  | { kind: "name" | "password"; user: AdminUser }
  | { kind: "role"; user: AdminUser; action: "grant" | "revoke" }
  | { kind: "status"; user: AdminUser; action: "enable" | "disable" };

const MAX_USER_NAME_LENGTH = 64;
const operationTitles = {
  name: "修改名称", password: "重置临时密码", role: "调整管理员角色", status: "调整账号状态",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN", { hour12: false });
}

function initials(user: AdminUser) {
  return Array.from(user.name.trim() || user.email).slice(0, 2).join("").toUpperCase();
}

export default function AdminUsersPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const operationTriggerRef = useRef<HTMLElement | null>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const operationInputRef = useRef<HTMLInputElement>(null);
  const detailCloseRef = useRef<HTMLButtonElement>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailTarget = useRef<string | null>(null);
  const operationPending = useRef(false);
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);

  // 中文注释：只采用最新的列表响应，刷新失败时明确提示，保留已加载的数据。
  const loadUsers = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      if (!response.ok) throw new Error("加载用户失败，请重试。");
      const payload = (await response.json()) as { items: AdminUser[] };
      if (request !== listRequest.current) return false;
      setItems(payload.items);
      setLoaded(true);
      return true;
    } catch {
      if (request === listRequest.current) setError("加载用户失败，请重试。若刚完成操作，可刷新核实最新状态。");
      return false;
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    return () => { listRequest.current++; detailRequest.current++; };
  }, [loadUsers]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !keyword || [item.email, item.name, item.id]
        .some((value) => value.toLowerCase().includes(keyword));
      const matchesRole = roleFilter === "all" || (roleFilter === "admin" ? item.isAdmin : !item.isAdmin);
      const matchesStatus = statusFilter === "all" || (statusFilter === "disabled" ? item.isDisabled : !item.isDisabled);
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [items, search, roleFilter, statusFilter]);
  const adminCount = items.filter((item) => item.isAdmin).length;
  const disabledCount = items.filter((item) => item.isDisabled).length;

  // 中文注释：详情响应同时校验请求序号和目标，防止关闭或切换用户后显示旧数据。
  async function loadDetail(userId: string) {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/detail`, { cache: "no-store" });
      if (!response.ok) throw new Error("detail");
      const payload = (await response.json()) as { item: UserDetail };
      if (request === detailRequest.current && detailTarget.current === userId) setDetail(payload.item);
    } catch {
      if (request === detailRequest.current && detailTarget.current === userId) setDetailError("加载用户详情失败，请重试。");
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }

  function openDetail(userId: string, trigger: HTMLElement) {
    detailTriggerRef.current = trigger;
    detailTarget.current = userId;
    setDetailOpen(true);
    void loadDetail(userId);
  }

  function closeDetail() {
    detailTarget.current = null;
    detailRequest.current++;
    setDetailOpen(false);
    setDetail(null);
    setDetailError(null);
  }

  function beginOperation(next: Operation) {
    setOperationError(null);
    setNotice(null);
    setEditName(next.kind === "name" ? next.user.name : "");
    setNewPassword("");
    setOperation(next);
  }

  function closeOperation() {
    if (operationPending.current) return;
    setOperation(null);
    setEditName("");
    setNewPassword("");
    setOperationError(null);
  }

  // 中文注释：请求方法来自确认的动作；所有写操作成功后刷新列表和已打开的详情。
  async function submitOperation() {
    if (!operation || operationPending.current) return;
    const current = operation;
    const normalizedName = editName.trim();
    if (current.kind === "name" && normalizedName.length > MAX_USER_NAME_LENGTH) {
      setOperationError(`名称长度不能超过 ${MAX_USER_NAME_LENGTH} 个字符。`);
      return;
    }
    const normalizedPassword = newPassword.trim();
    if (current.kind === "password" && normalizedPassword.length < 8) {
      setOperationError("临时密码至少需要 8 位。请设置一个新的密码。");
      return;
    }
    operationPending.current = true;
    setPendingUserId(current.user.id);
    setOperationError(null);
    setNotice(null);
    let path = `/api/admin/users/${encodeURIComponent(current.user.id)}`;
    let method = "PATCH";
    let body: string | undefined;
    if (current.kind === "name") body = JSON.stringify({ name: normalizedName });
    if (current.kind === "status") body = JSON.stringify({ isDisabled: current.action === "disable" });
    if (current.kind === "role") {
      path += "/admin-role";
      method = current.action === "grant" ? "POST" : "DELETE";
    }
    if (current.kind === "password") {
      path += "/reset-password";
      method = "POST";
      body = JSON.stringify({ newPassword: normalizedPassword });
    }
    try {
      const response = await fetch(path, {
        method, ...(body ? { headers: { "content-type": "application/json" }, body } : {}),
      });
      if (!response.ok) {
        setOperationError("操作失败，未确认更改。请检查权限后重试。");
        return;
      }
      setOperation(null);
      setEditName("");
      setNewPassword("");
      setNotice(current.kind === "password"
        ? "临时密码已重置，用户需在下次登录时修改密码，原有会话已撤销。"
        : "更改已保存。");
      await loadUsers();
      if (detailTarget.current === current.user.id) await loadDetail(current.user.id);
    } catch {
      setOperationError("请求中断，结果尚未确认。请先刷新核实用户状态，再重试。");
    } finally {
      operationPending.current = false;
      setPendingUserId(null);
    }
  }

  function clearFilters() { setSearch(""); setRoleFilter("all"); setStatusFilter("all"); }
  // 中文注释：写操作刷新时行按钮仍禁用，将关闭后的焦点交给可用的搜索框。
  function returnFocus(trigger: HTMLElement | null) {
    return trigger?.isConnected && !trigger.matches(':disabled, [aria-disabled="true"]')
      ? trigger : searchRef.current;
  }
  const operationBusy = !!operation && pendingUserId === operation.user.id;
  const operationLabel = operation?.kind === "role"
    ? (operation.action === "grant" ? "授予管理员" : "撤销管理员")
    : operation?.kind === "status"
      ? (operation.action === "enable" ? "启用账号" : "停用账号")
      : operation?.kind === "password" ? "确认重置" : "保存名称";

  return (
    <div className="admin-users-page" ref={pageRef}>
      <main className="admin-page">
        <header className="users-header">
          <div className="users-header-copy">
            <h1 className="admin-page-title">用户管理</h1>
            <p className="admin-page-description">管理账号状态、管理员角色与登录安全。</p>
          </div>
          <dl className="users-summary" aria-label="用户统计">
            {[["全部用户", items.length], ["管理员", adminCount], ["已停用", disabledCount]].map(([label, count]) => (
              <div className="users-summary-item" key={label}>
                <dt>{label}</dt><dd>{loaded ? count : loading ? "…" : "未知"}</dd>
              </div>
            ))}
          </dl>
        </header>

        <div className="users-scope-note">
          <LockClosedIcon aria-hidden="true" />
          <p>谁能看哪些服务目录，在运维控制台配置。</p>
          <a href="https://ops.gaodi.app/catalog/index.html#access" target="_blank" rel="noreferrer">
            目录权限<ArrowTopRightIcon aria-hidden="true" />
          </a>
        </div>

        {error ? <div className="users-notice is-error" role="alert"><ExclamationTriangleIcon aria-hidden="true" />{error}</div> : null}
        {notice ? <div className="users-notice is-success" role="status"><CheckCircledIcon aria-hidden="true" />{notice}</div> : null}

        <section className="users-panel" aria-label="用户列表" aria-busy={loading}>
          <div className="users-panel-heading"><h2>账号列表</h2><span>{loaded ? `${items.length} 位用户` : loading ? "正在加载" : "加载失败"}</span></div>
          <div className="users-toolbar">
            <div className="users-search">
              <MagnifyingGlassIcon aria-hidden="true" />
              <Input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)}
                className="admin-input" aria-label="搜索用户" placeholder="搜索名称、邮箱或用户 ID" />
              {search ? <Button className="users-search-clear" aria-label="清除搜索" onClick={() => setSearch("")}><Cross2Icon aria-hidden="true" /></Button> : null}
            </div>
            <div className="users-filters">
              <select className="users-filter" aria-label="筛选角色" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="all">全部角色</option><option value="admin">管理员</option><option value="member">普通用户</option>
              </select>
              <select className="users-filter" aria-label="筛选状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">全部状态</option><option value="active">已启用</option><option value="disabled">已停用</option>
              </select>
              <Button className="admin-btn" disabled={loading || !!pendingUserId} onClick={() => void loadUsers()}>
                <ReloadIcon aria-hidden="true" />{loading ? "刷新中" : "刷新"}
              </Button>
            </div>
          </div>

          <div className="users-table-wrap">
            <table className="users-table">
              <thead><tr><th scope="col">用户</th><th scope="col">角色</th><th scope="col">状态</th><th scope="col">密码策略</th><th scope="col">操作</th></tr></thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td><div className="users-identity"><span className="users-avatar" aria-hidden="true">{initials(item)}</span>
                      <div className="users-identity-copy"><strong className="users-name">{item.name || "未设置名称"}</strong><span className="users-email">{item.email}</span></div>
                    </div></td>
                    <td data-label="角色"><span className={`users-badge ${item.isAdmin ? "is-admin" : "is-member"}`}>{item.isAdmin ? "管理员" : "普通用户"}</span></td>
                    <td data-label="状态"><span className={`users-badge ${item.isDisabled ? "is-disabled" : "is-active"}`}>{item.isDisabled ? "已停用" : "已启用"}</span></td>
                    <td data-label="密码策略">{item.mustChangePassword ? <span className="users-badge is-warning">下次登录改密</span> : <span className="users-policy-text">常规</span>}</td>
                    <td><div className="users-row-actions">
                      <Button className="admin-btn users-detail-button" disabled={!!pendingUserId}
                        aria-label={`查看 ${item.email} 的详情`} onClick={(event) => openDetail(item.id, event.currentTarget)}>详情</Button>
                      <Menu.Root>
                        <Menu.Trigger className="admin-btn users-more-button" aria-label={`管理 ${item.email}`} disabled={!!pendingUserId}
                          onFocus={(event) => { operationTriggerRef.current = event.currentTarget; }}><DotsHorizontalIcon aria-hidden="true" /></Menu.Trigger>
                        <Menu.Portal container={pageRef}><Menu.Positioner className="users-menu-positioner" side="bottom" align="end" sideOffset={6}>
                          <Menu.Popup className="users-menu">
                            <Menu.Item className="users-menu-item" onClick={() => beginOperation({ kind: "name", user: item })}><Pencil1Icon aria-hidden="true" />修改名称</Menu.Item>
                            <Menu.Item className="users-menu-item" onClick={() => beginOperation({ kind: "password", user: item })}><LockClosedIcon aria-hidden="true" />重置临时密码</Menu.Item>
                            <Menu.Item className="users-menu-item" onClick={() => beginOperation({ kind: "role", user: item, action: item.isAdmin ? "revoke" : "grant" })}><PersonIcon aria-hidden="true" />{item.isAdmin ? "撤销管理员" : "授予管理员"}</Menu.Item>
                            <Menu.Separator className="users-menu-separator" />
                            <Menu.Item className={`users-menu-item ${item.isDisabled ? "" : "is-danger"}`} onClick={() => beginOperation({ kind: "status", user: item, action: item.isDisabled ? "enable" : "disable" })}>{item.isDisabled ? "启用账号" : "停用账号"}</Menu.Item>
                          </Menu.Popup>
                        </Menu.Positioner></Menu.Portal>
                      </Menu.Root>
                    </div></td>
                  </tr>
                ))}
                {!filteredItems.length ? <tr><td colSpan={5} className="users-empty-cell"><div className="users-state">
                  <PersonIcon aria-hidden="true" />
                  <strong>{loading && !loaded ? "正在加载用户" : error && !loaded ? "暂时无法加载用户" : items.length ? "没有匹配的用户" : "暂无用户"}</strong>
                  <p>{loading && !loaded ? "请稍候，正在获取账号列表。" : error && !loaded ? "请检查连接后重新加载。" : items.length ? "尝试其他关键词，或清除筛选条件。" : "用户登录并注册后会出现在这里。"}</p>
                  {loaded && items.length ? <Button className="admin-btn" onClick={clearFilters}>清除筛选</Button> : error && !loading ? <Button className="admin-btn" onClick={() => void loadUsers()}>重新加载</Button> : null}
                </div></td></tr> : null}
              </tbody>
            </table>
          </div>
          <footer className="users-table-footer"><span>{loaded ? `显示 ${filteredItems.length} / ${items.length} 位用户` : loading ? "正在获取用户列表" : "尚未获取用户列表"}</span><span>管理员操作请谨慎确认</span></footer>
        </section>
      </main>

      <Dialog.Root open={detailOpen} onOpenChange={(open) => { if (!open) closeDetail(); }}>
        <Dialog.Portal container={pageRef}><Dialog.Backdrop className="users-backdrop" />
          <Dialog.Viewport className="users-dialog-viewport users-drawer-view">
          <Dialog.Popup className="users-drawer" initialFocus={detailCloseRef} finalFocus={() => returnFocus(detailTriggerRef.current)}>
            <div className="users-dialog-header"><div><Dialog.Title>用户详情</Dialog.Title><Dialog.Description className="users-dialog-description">身份信息、账号绑定与会话记录。</Dialog.Description></div>
              <Dialog.Close ref={detailCloseRef} className="admin-btn users-icon-button" aria-label="关闭用户详情"><Cross2Icon aria-hidden="true" /></Dialog.Close>
            </div>
            <div className="users-dialog-body">
              {detailLoading ? <div className="users-state" role="status">正在加载详情…</div> : null}
              {detailError ? <div className="users-notice is-error" role="alert">{detailError}<Button className="admin-btn" onClick={() => { if (detailTarget.current) void loadDetail(detailTarget.current); }}>重试</Button></div> : null}
              {detail ? <>
                <div className="users-identity users-detail-identity"><span className="users-avatar" aria-hidden="true">{initials(detail)}</span><div className="users-identity-copy"><strong className="users-name">{detail.name || "未设置名称"}</strong><span className="users-email">{detail.email}</span></div></div>
                <dl className="users-detail-list">
                  <div><dt>用户 ID</dt><dd><code>{detail.id}</code></dd></div>
                  <div><dt>角色</dt><dd>{detail.isAdmin ? "管理员" : "普通用户"}</dd></div>
                  <div><dt>状态</dt><dd>{detail.isDisabled ? "已停用" : "已启用"}</dd></div>
                  <div><dt>密码策略</dt><dd>{detail.mustChangePassword ? "下次登录需修改密码" : "常规"}</dd></div>
                  <div><dt>创建时间</dt><dd>{formatDate(detail.createdAt)}</dd></div>
                  <div><dt>更新时间</dt><dd>{formatDate(detail.updatedAt)}</dd></div>
                </dl>
                <section className="users-detail-section"><h3>账号绑定 <span>{detail.accounts.length}</span></h3>
                  {detail.accounts.length ? <ul className="users-binding-list">{detail.accounts.map((account) => <li className="users-record" key={account.id}>
                    <strong>{account.providerId}</strong><dl><div><dt>账号标识</dt><dd><code>{account.accountId}</code></dd></div><div><dt>授权范围</dt><dd>{account.scope || "未提供"}</dd></div><div><dt>更新时间</dt><dd>{formatDate(account.updatedAt)}</dd></div></dl>
                  </li>)}</ul> : <p className="admin-muted">暂无账号绑定</p>}
                </section>
                <section className="users-detail-section"><h3>会话记录 <span>{detail.sessions.length}</span></h3>
                  {detail.sessions.length ? <ul className="users-binding-list">{detail.sessions.map((session) => <li className="users-record" key={session.id}>
                    <dl><div><dt>会话 ID</dt><dd><code>{session.id}</code></dd></div><div><dt>IP 地址</dt><dd>{session.ipAddress || "未提供"}</dd></div><div><dt>设备信息</dt><dd>{session.userAgent || "未提供"}</dd></div><div><dt>过期时间</dt><dd>{formatDate(session.expiresAt)}</dd></div></dl>
                  </li>)}</ul> : <p className="admin-muted">暂无会话记录</p>}
                </section>
              </> : null}
            </div>
          </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={!!operation} onOpenChange={(open) => { if (!open) closeOperation(); }} disablePointerDismissal={operationBusy}>
        <Dialog.Portal container={pageRef}><Dialog.Backdrop className="users-backdrop" />
          <Dialog.Viewport className="users-dialog-viewport">
          <Dialog.Popup className="users-modal" initialFocus={operation?.kind === "name" || operation?.kind === "password" ? operationInputRef : cancelRef}
            finalFocus={() => returnFocus(operationTriggerRef.current)}>
            {operation ? <form onSubmit={(event) => { event.preventDefault(); void submitOperation(); }}>
              <div className="users-dialog-header"><Dialog.Title>{operationTitles[operation.kind]}</Dialog.Title>
                <Button className="admin-btn users-icon-button" aria-label="关闭操作" disabled={operationBusy} onClick={closeOperation}><Cross2Icon aria-hidden="true" /></Button>
              </div>
              <div className="users-dialog-body">
                <Dialog.Description className="users-dialog-description">目标用户：<strong>{operation.user.email}</strong></Dialog.Description>
                {operation.kind === "name" ? <label className="users-field"><span>名称</span><Input ref={operationInputRef} className="admin-input" value={editName} onChange={(event) => setEditName(event.target.value)} disabled={operationBusy} maxLength={MAX_USER_NAME_LENGTH} /><span className="users-field-hint">最多 64 个字符，保存时移除首尾空格。</span></label> : null}
                {operation.kind === "password" ? <><p className="users-field-hint">重置后原有会话将撤销，用户需在下次登录时修改密码。</p><label className="users-field"><span>临时密码</span><Input ref={operationInputRef} className="admin-input" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={operationBusy} placeholder="请输入至少 8 位的新密码" /><span className="users-field-hint">至少 8 位，首尾空格会移除。请每次设置不同的临时密码。</span></label></> : null}
                {operation.kind === "role" ? <p className="users-field-hint">{operation.action === "grant" ? "授予后，此用户将能管理认证控制台中的用户、应用接入与授权配置。请确认目标账号。" : "将撤销此用户的管理员角色。请确认目标账号。"}</p> : null}
                {operation.kind === "status" ? <p className="users-field-hint">{operation.action === "disable" ? "停用后，此用户将无法登录，现有会话也将失效。" : "启用后，此用户可重新登录账号。"}</p> : null}
                {operationError ? <div className="users-notice is-error" role="alert"><ExclamationTriangleIcon aria-hidden="true" />{operationError}</div> : null}
              </div>
              <div className="users-dialog-footer"><Button ref={cancelRef} className="admin-btn" onClick={closeOperation} disabled={operationBusy}>取消</Button>
                <Button type="submit" className={`admin-btn ${operation.kind === "status" && operation.action === "disable" ? "admin-btn-danger" : "admin-btn-primary"}`} disabled={operationBusy}>{operationBusy ? "处理中…" : operationLabel}</Button>
              </div>
            </form> : null}
          </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
