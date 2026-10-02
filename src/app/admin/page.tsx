"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@base-ui-components/react/button";
import {
  ActivityLogIcon,
  ArrowRightIcon,
  ExclamationTriangleIcon,
  IdCardIcon,
  LockClosedIcon,
  PersonIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";

type DashboardState = {
  users: number;
  clients: number;
  audits: number;
  disabledUsers: number;
  adminUsers: number;
};

type AuditItem = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
};

const initialDashboardState: DashboardState = {
  users: 0,
  clients: 0,
  audits: 0,
  disabledUsers: 0,
  adminUsers: 0,
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 中文注释：审计时间统一按中文短格式展示，避免完整时间戳撑宽活动列表。 */
function formatAuditTime(value: string) {
  return dateFormatter.format(new Date(value));
}

export const dynamic = "force-dynamic";

export default function AdminHomePage() {
  const [state, setState] = useState<DashboardState>(initialDashboardState);
  const [recentAudits, setRecentAudits] = useState<AuditItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** 中文注释：聚合首页只读数据，重试与首屏加载复用同一条请求链路。 */
  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, clientsRes, auditsRes] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store", signal }),
        fetch("/api/admin/clients", { cache: "no-store", signal }),
        fetch("/api/admin/audits", { cache: "no-store", signal }),
      ]);
      if (!usersRes.ok || !clientsRes.ok || !auditsRes.ok) {
        throw new Error("dashboard_unavailable");
      }

      const usersPayload = (await usersRes.json()) as {
        items: Array<{ isDisabled: boolean; isAdmin?: boolean }>;
      };
      const clientsPayload = (await clientsRes.json()) as { items: Array<unknown> };
      const auditsPayload = (await auditsRes.json()) as { items: AuditItem[] };
      const disabledUsers = usersPayload.items.filter((item) => item.isDisabled).length;
      const adminUsers = usersPayload.items.filter((item) => item.isAdmin).length;

      setState({
        users: usersPayload.items.length,
        clients: clientsPayload.items.length,
        audits: auditsPayload.items.length,
        disabledUsers,
        adminUsers,
      });
      setRecentAudits(auditsPayload.items.slice(0, 6));
    } catch {
      if (!signal?.aborted) {
        setError("暂时无法读取管理数据。请检查管理员会话后重试。");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboard(controller.signal);
    return () => controller.abort();
  }, [loadDashboard]);

  const cards = useMemo(
    () => [
      { label: "身份总数", value: state.users, detail: "当前实例用户", icon: PersonIcon },
      { label: "接入应用", value: state.clients, detail: "OIDC 客户端", icon: IdCardIcon },
      { label: "管理员", value: state.adminUsers, detail: "特权身份", icon: LockClosedIcon },
      {
        label: "禁用用户",
        value: state.disabledUsers,
        detail: state.disabledUsers > 0 ? "需要持续复核" : "当前无禁用账号",
        icon: ExclamationTriangleIcon,
      },
    ],
    [state],
  );

  return (
    <main className="admin-page admin-dashboard">
      <header className="admin-page-header admin-dashboard-header">
        <div>
          <p className="admin-eyebrow">身份与接入</p>
          <h1 className="admin-page-title">认证控制台</h1>
          <p className="admin-page-description">
            从一个视图掌握身份、应用授权与管理操作。所有指标均来自当前实例。
          </p>
        </div>
        <div className="admin-actions-row">
          <Link href="/admin/users" className="admin-btn admin-btn-secondary">
            <PersonIcon aria-hidden="true" />
            管理用户
          </Link>
          <Link href="/admin/clients" className="admin-btn admin-btn-primary">
            <IdCardIcon aria-hidden="true" />
            新建应用接入
          </Link>
        </div>
      </header>

      {loading ? (
        <section className="admin-dashboard-loading" aria-label="正在加载控制台数据">
          <div className="admin-metric-strip">
            {cards.map((card) => (
              <div key={card.label} className="admin-metric-item admin-skeleton-metric">
                <span className="admin-skeleton admin-skeleton-label" />
                <span className="admin-skeleton admin-skeleton-value" />
              </div>
            ))}
          </div>
          <div className="admin-dashboard-grid">
            <div className="admin-panel admin-skeleton-panel" />
            <div className="admin-posture admin-skeleton-panel" />
          </div>
        </section>
      ) : error ? (
        <section className="admin-error-state" role="alert">
          <span className="admin-error-icon" aria-hidden="true">
            <ExclamationTriangleIcon />
          </span>
          <div>
            <h2>控制台数据未加载</h2>
            <p>{error}</p>
          </div>
          <Button className="admin-btn admin-btn-secondary" onClick={() => void loadDashboard()}>
            <ReloadIcon aria-hidden="true" />
            重新加载
          </Button>
        </section>
      ) : (
        <>
          <section className="admin-metric-strip" aria-label="身份统计概览">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <article key={card.label} className="admin-metric-item">
                  <div className="admin-metric-heading">
                    <Icon aria-hidden="true" />
                    <p>{card.label}</p>
                  </div>
                  <p className="admin-metric-value">{card.value.toLocaleString("zh-CN")}</p>
                  <p className="admin-metric-detail">{card.detail}</p>
                </article>
              );
            })}
          </section>

          <div className="admin-dashboard-grid">
            <section className="admin-panel admin-activity-panel">
              <div className="admin-panel-header">
                <div>
                  <p className="admin-section-kicker">ACTIVITY STREAM</p>
                  <h2>近期审计事件</h2>
                </div>
                <Link href="/admin/audits" className="admin-link-inline">
                  查看全部
                  <ArrowRightIcon aria-hidden="true" />
                </Link>
              </div>

              {recentAudits.length > 0 ? (
                <ol className="admin-activity-list">
                  {recentAudits.map((item) => (
                    <li key={item.id}>
                      <span className="admin-activity-icon" aria-hidden="true">
                        <ActivityLogIcon />
                      </span>
                      <div className="admin-activity-copy">
                        <strong>{item.action}</strong>
                        <span>
                          {item.targetType} · <code>{item.targetId}</code>
                        </span>
                      </div>
                      <time dateTime={item.createdAt}>{formatAuditTime(item.createdAt)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="admin-empty-state">
                  <ActivityLogIcon aria-hidden="true" />
                  <h3>还没有审计事件</h3>
                  <p>管理操作发生后，事件会按时间顺序出现在这里。</p>
                </div>
              )}
            </section>

            <aside className="admin-posture" aria-label="安全态势">
              <div className="admin-posture-header">
                <p className="admin-section-kicker">SECURITY POSTURE</p>
                <h2>实例态势</h2>
              </div>
              <div className="admin-posture-signal">
                <span
                  className={`admin-status-orb${state.disabledUsers > 0 ? " admin-status-orb-warning" : ""}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>{state.disabledUsers > 0 ? "存在禁用身份" : "访问状态正常"}</strong>
                  <span>
                    {state.disabledUsers > 0
                      ? `${state.disabledUsers} 个账号当前无法登录`
                      : "未发现禁用账号"}
                  </span>
                </div>
              </div>
              <dl className="admin-posture-list">
                <div><dt>特权身份</dt><dd>{state.adminUsers}</dd></div>
                <div><dt>OIDC 客户端</dt><dd>{state.clients}</dd></div>
                <div><dt>审计事件总数</dt><dd>{state.audits.toLocaleString("zh-CN")}</dd></div>
              </dl>
              <Link href="/admin/users" className="admin-posture-link">
                检查身份权限
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </aside>
          </div>

          <section className="admin-quick-links" aria-label="常用管理入口">
            <Link href="/admin/clients" className="admin-quick-link">
              <span className="admin-quick-icon" aria-hidden="true"><IdCardIcon /></span>
              <span>
                <strong>配置应用接入</strong>
                <small>管理回调地址、Scope 与访问账号</small>
              </span>
              <ArrowRightIcon aria-hidden="true" />
            </Link>
            <Link href="/admin/users" className="admin-quick-link">
              <span className="admin-quick-icon" aria-hidden="true"><PersonIcon /></span>
              <span>
                <strong>维护用户身份</strong>
                <small>处理状态、角色与临时密码</small>
              </span>
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </section>
        </>
      )}
    </main>
  );
}
