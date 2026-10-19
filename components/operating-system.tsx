'use client';
import { Today } from './today';
import { ThemeToggle } from './theme-toggle';
import { useRouter } from 'next/navigation';
import { hasDemoContext } from '@/lib/demo';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardCheck,
  Compass,
  Database,
  Download,
  FileText,
  FlaskConical,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Workspace } from '@/lib/workspace';
type Json<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
type Data = Json<Workspace> & { user: { name: string; email: string }; provider: string };
type Tab =
  | 'Today'
  | 'Overview'
  | 'Daily metrics'
  | 'Channels'
  | 'Experiments'
  | 'CMO intelligence'
  | 'Briefs & plans'
  | 'Knowledge base'
  | 'Institutional memory'
  | 'Forecast'
  | 'Alerts'
  | 'Approvals'
  | 'Audit log'
  | 'CSV import'
  | 'Settings';
const navigation: { group: string; tabs: [Tab, LucideIcon][] }[] = [
  {
    group: 'COMMAND CENTER',
    tabs: [
      ['Today', ClipboardCheck],
      ['Overview', LayoutDashboard],
      ['CMO intelligence', Sparkles],
      ['Briefs & plans', FileText],
    ],
  },
  {
    group: 'GROWTH ENGINE',
    tabs: [
      ['Daily metrics', Activity],
      ['Channels', Compass],
      ['Experiments', FlaskConical],
      ['Forecast', TrendingUp],
    ],
  },
  {
    group: 'COMPANY CONTEXT',
    tabs: [
      ['Knowledge base', BookOpen],
      ['Institutional memory', History],
    ],
  },
  {
    group: 'GOVERNANCE',
    tabs: [
      ['Alerts', Bell],
      ['Approvals', ClipboardCheck],
      ['Audit log', ShieldCheck],
      ['CSV import', Upload],
      ['Settings', Settings],
    ],
  },
];
const descriptions: Record<Tab, string> = {
  Today: 'Your focused workday: review, approve, execute and learn.',
  Overview: 'The signals that matter. The actions that move you forward.',
  'Daily metrics': 'One reliable record of growth, one day at a time.',
  Channels: 'Understand where subscribers come from and what acquisition costs.',
  Experiments: 'Turn hypotheses into measurable growth and durable learnings.',
  'CMO intelligence': 'A CMO grounded in your company’s knowledge and operating evidence.',
  'Briefs & plans': 'From daily signals to monthly direction. Generate, review, retain.',
  'Knowledge base': 'The source of truth that shapes every CMO recommendation.',
  'Institutional memory': 'Decisions, lessons, and context that stay with the company.',
  Forecast: 'A transparent view of the path from 50 to 5,000.',
  Alerts: 'Signals that deserve a human’s attention.',
  Approvals: 'Human decisions first. No autonomous external actions.',
  'Audit log': 'A durable record of who changed what, and when.',
  'CSV import': 'Bring your daily observations into one shared source of truth.',
  Settings: 'Set the company context and the ambition you are building toward.',
};
const number = (value: number | null | undefined) =>
  value == null ? '—' : Math.round(value).toLocaleString();
const money = (value: number | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(value);
const dateLabel = (date: string) =>
  new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Demo({ value }: { value: boolean }) {
  return value ? <Badge tone="demo">DEMO</Badge> : <Badge tone="neutral">MANUAL</Badge>;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
function Panel({
  title,
  subtitle,
  children,
  action,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
type Field = {
  name: string;
  label: string;
  type?: string;
  options?: string[];
  value?: string | number;
  min?: number;
  max?: number;
  help?: string;
  required?: boolean;
};
function Editor({
  title,
  subtitle,
  fields,
  onSave,
  button = 'Save record',
  children,
}: {
  title: string;
  subtitle?: string;
  fields: Field[];
  onSave: (values: Record<string, unknown>) => Promise<void>;
  button?: string;
  children?: ReactNode;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      await onSave(Object.fromEntries(new FormData(form)));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title={title} subtitle={subtitle}>
      <form className="editor" onSubmit={submit}>
        <div className="form-grid">
          {fields.map((f) => (
            <label key={f.name} className={f.type === 'textarea' ? 'wide' : ''}>
              {f.label}
              {f.type === 'textarea' ? (
                <textarea
                  name={f.name}
                  defaultValue={f.value ?? ''}
                  required={f.required !== false}
                  maxLength={10000}
                  rows={4}
                />
              ) : f.options ? (
                <select name={f.name} defaultValue={f.value}>
                  {f.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  name={f.name}
                  type={f.type || 'text'}
                  defaultValue={f.value ?? ''}
                  min={f.min ?? (f.type === 'number' ? 0 : undefined)}
                  max={f.max}
                  step={f.type === 'number' ? 'any' : undefined}
                  required={f.required !== false}
                  maxLength={f.type === 'text' || !f.type ? 200 : undefined}
                />
              )}{' '}
              {f.help && <small>{f.help}</small>}
            </label>
          ))}
        </div>
        {children}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : button}
            <Check size={15} />
          </button>
          {saved && (
            <span className="success" role="status">
              Saved to PostgreSQL
            </span>
          )}
        </div>
      </form>
    </Panel>
  );
}
function TrendChart({ data }: { data: Data }) {
  const points = data.summary.trajectory;
  const max = data.company.goalTarget * 1.08;
  const y = (value: number) => 218 - (value / max) * 185;
  const targetPath = points
    .map((p, i) => `${i ? 'L' : 'M'} ${50 + (i / 12) * 650} ${y(p.target)}`)
    .join(' ');
  const start = Date.parse(data.company.goalStartDate);
  const end = Date.parse(data.company.goalEndDate);
  const actual = data.metrics.filter(
    (m) => Date.parse(m.date) >= start && Date.parse(m.date) <= end,
  );
  const actualPath = actual
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'} ${50 + ((Date.parse(p.date) - start) / (end - start)) * 650} ${y(p.subscribers)}`,
    )
    .join(' ');
  return (
    <div className="chart">
      <svg
        viewBox="0 0 750 255"
        role="img"
        aria-label="Subscriber trajectory: actual subscribers versus the 12-month compounded target"
      >
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9ed6bd" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#9ed6bd" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1="50"
              x2="700"
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="#e8ecea"
              strokeDasharray="3 5"
            />
            <text x="40" y={y(max * f) + 4} textAnchor="end" fontSize="10" fill="#89958e">
              {number(max * f)}
            </text>
          </g>
        ))}
        <path d={`${targetPath} L700 218 L50 218 Z`} fill="url(#chartFill)" />
        <path d={targetPath} fill="none" stroke="#b1c9bc" strokeWidth="2" strokeDasharray="5 5" />
        <path d={actualPath} fill="none" stroke="#168564" strokeWidth="3.5" />
        {actual.at(-1) && (
          <circle
            cx={50 + ((Date.parse(actual.at(-1)!.date) - start) / (end - start)) * 650}
            cy={y(actual.at(-1)!.subscribers)}
            r="5"
            fill="#168564"
            stroke="white"
            strokeWidth="2"
          />
        )}
        {[0, 3, 6, 9, 12].map((i) => (
          <text
            key={i}
            x={50 + (i / 12) * 650}
            y="245"
            textAnchor="middle"
            fontSize="11"
            fill="#89958e"
          >
            {i === 0 ? 'START' : `MONTH ${i}`}
          </text>
        ))}
      </svg>
      <div className="chart-legend">
        <span>
          <i className="legend-line" />
          Actual subscribers
        </span>
        <span>
          <i className="legend-line target" />
          Compounded target
        </span>
      </div>
    </div>
  );
}
export function OperatingSystem() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [error, setError] = useState('');
  const [mobile, setMobile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch('/api/workspace', { cache: 'no-store' });
    if (res.status === 401) {
      router.replace('/login');
      router.refresh();
      return;
    }
    if (!res.ok)
      throw new Error('Could not load workspace. Check the database connection and seed.');
    setData(await res.json());
  }, [router]);
  useEffect(() => {
    let active = true;
    fetch('/api/workspace', { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace('/login');
          router.refresh();
          return;
        }
        if (!res.ok)
          throw new Error('Could not load workspace. Check the database connection and seed.');
        const result = await res.json();
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [router]);
  async function mutate(resource: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/${resource}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Request failed');
    await load();
  }
  const navigate = (next: Tab) => {
    setTab(next);
    setMobile(false);
    setError('');
  };
  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }
  if (!data)
    return (
      <main className="loading">
        <span className="brand-icon">
          <TrendingUp />
        </span>
        <h2>Opening your growth workspace</h2>
        {error ? (
          <>
            <p role="alert" className="error">
              {error}
            </p>
            <button onClick={refresh} className="btn">
              Try again
            </button>
          </>
        ) : (
          <p className="muted">Connecting to your company’s operating evidence…</p>
        )}
      </main>
    );
  const s = data.summary;
  const pending = data.approvals.filter((a) => a.status === 'PENDING').length;
  const activeAlerts = data.alerts.filter((a) => !a.acknowledged).length;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-icon">
            <TrendingUp size={21} />
          </span>
          TradeLink<span className="brand-dot">●</span>
          <button
            className="icon-btn mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-label">
          CMO OPERATING SYSTEM <span>V1</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.group}>
              <p>{group.group}</p>
              {group.tabs.map(([name, Icon]) => (
                <button
                  key={name}
                  aria-label={name}
                  className={tab === name ? 'active' : ''}
                  onClick={() => navigate(name)}
                >
                  <Icon size={17} />
                  <span>{name}</span>
                  {name === 'Approvals' && pending > 0 && <b>{pending}</b>}
                  {name === 'Alerts' && activeAlerts > 0 && <b>{activeAlerts}</b>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ShieldCheck size={17} />
          <div>
            <strong>Human-led. Always.</strong>
            <small>External actions require approval</small>
          </div>
        </div>
        <button
          className="profile"
          onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            router.replace('/login');
            router.refresh();
          }}
        >
          <span className="avatar">TL</span>
          <span>
            <strong>{data.user.name}</strong>
            <small>Internal administrator</small>
          </span>
          <LogOut size={15} />
        </button>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn menu-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{tab}</strong>
          </div>
          <div className="topbar-right">
            <SyncAllButton mutate={mutate} />
            <ThemeToggle />
            <span className="connection">
              <i />
              PostgreSQL connected
            </span>
            <button
              aria-label="Refresh workspace"
              className={`icon-btn ${refreshing ? 'spin' : ''}`}
              onClick={refresh}
            >
              <RefreshCw size={17} />
            </button>
            <button
              aria-label="View alerts"
              className="icon-btn"
              onClick={() => navigate('Alerts')}
            >
              <Bell size={18} />
              {activeAlerts > 0 && <i className="notification-dot" />}
            </button>
            <span className="avatar small">TL</span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">TRADELINK / GROWTH WORKSPACE</span>
              <h1>
                {tab === 'Overview'
                  ? 'Growth, at a glance.'
                  : tab === 'CMO intelligence'
                    ? 'Your strategic counterpart.'
                    : tab}
              </h1>
              <p>{descriptions[tab]}</p>
            </div>
            <div className="heading-actions">
              {tab === 'Overview' && (
                <>
                  <button className="btn" onClick={() => navigate('Daily metrics')}>
                    <Plus size={16} />
                    Add metrics
                  </button>
                  <button className="btn primary" onClick={() => navigate('Briefs & plans')}>
                    <Sparkles size={16} />
                    Generate brief
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="demo-banner">
            <span>
              <Database size={16} />
              <strong>
                {hasDemoContext(data)
                  ? 'Demo workspace'
                  : data.stripe.lastSync
                    ? 'Live workspace'
                    : 'Manual data workspace'}
              </strong>
              <span>
                {hasDemoContext(data)
                  ? 'Sample records are labeled DEMO. Replace assumptions before making business decisions.'
                  : data.stripe.lastSync
                    ? 'Uses verified integration snapshots and manual inputs. Sync all refreshes connected sources; automatic sync runs at 4 a.m. Eastern.'
                    : 'Manual observations. Stripe has not been synced.'}
              </span>
            </span>
            <Badge tone="demo">{data.provider}</Badge>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {tab === 'Overview' && (
            <>
              <div className="stats-grid">
                <Stat
                  label="TOTAL SUBSCRIBERS"
                  value={number(s.current)}
                  detail={
                    s.latest
                      ? `As of ${dateLabel(s.latest.date)} · ${s.latest.isDemo ? 'demo' : s.latest.source}`
                      : 'No observations yet'
                  }
                  icon={Target}
                />
                <Stat
                  label="PACE TO TARGET"
                  value={
                    s.pacePercent == null
                      ? '—'
                      : `${s.pacePercent > 0 ? '+' : ''}${s.pacePercent.toFixed(1)}%`
                  }
                  detail={`${number(s.expected)} expected today`}
                  tone={s.status === 'AHEAD' ? 'green' : 'amber'}
                  icon={s.status === 'AHEAD' ? ArrowUpRight : ArrowDownRight}
                />
                <Stat
                  label={
                    s.latest?.source === 'stripe'
                      ? 'GROSS MONTHLY RECURRING REVENUE'
                      : 'MONTHLY RECURRING REVENUE'
                  }
                  value={s.latest ? money(s.latest.mrr) : '—'}
                  detail={
                    s.latest?.source === 'stripe'
                      ? 'USD · before discounts, refunds, credits and fees; tax treatment follows the price'
                      : 'Latest daily observation · USD'
                  }
                  icon={Activity}
                />
                <Stat
                  label="DAYS TO THE GOAL"
                  value={number(s.remainingDays)}
                  detail={`${number(data.company.goalTarget)} subscribers by ${dateLabel(data.company.goalEndDate)}`}
                  icon={Compass}
                />
              </div>
              <div className="overview-grid">
                <Panel
                  title="The path to 5,000"
                  subtitle="A 12-month ambition, made measurable"
                  action={<Badge tone="green">50 → {number(data.company.goalTarget)}</Badge>}
                >
                  <TrendChart data={data} />
                  <div className="chart-foot">
                    <span>
                      <strong>{number(s.current)}</strong> current subscribers
                    </span>
                    <span>
                      <strong>{s.requiredDaily?.toFixed(1) ?? '—'}</strong> net additions / day
                      needed
                    </span>
                    <span>
                      <strong>{s.sampleDays}</strong> observed days in recent window
                    </span>
                  </div>
                </Panel>
                <section className="insight-card">
                  <span className="eyebrow">
                    <Sparkles size={15} /> CMO PERSPECTIVE
                  </span>
                  <h2>
                    {s.status === 'BEHIND'
                      ? 'Close the gap with focused growth.'
                      : s.status === 'AHEAD'
                        ? s.forecasts.base !== null && s.forecasts.base < data.company.goalTarget
                          ? 'Ahead today. More growth needed.'
                          : 'Build on the momentum.'
                        : 'Start with a reliable baseline.'}
                  </h2>
                  <p>
                    {s.current == null
                      ? 'Add your first daily metrics to assess pace and surface the next priorities.'
                      : `You are ${Math.abs(s.gap!).toLocaleString()} subscribers ${s.status.toLowerCase()} the trajectory. Focus the team on the highest-impact experiments and record what you learn.`}
                  </p>
                  <div className="insight-rule" />
                  <small>NEXT BEST ACTION</small>
                  <h4>{data.priorities[0]?.title || 'Create a measurable growth experiment'}</h4>
                  <p className="small-copy">
                    {data.priorities[0]
                      ? `${data.priorities[0].channel} · ICE ${data.priorities[0].score}/1000 · ${data.priorities[0].isDemo ? 'demo hypothesis' : 'team hypothesis'}`
                      : 'Prioritize by impact, confidence, and ease.'}
                  </p>
                  <button onClick={() => navigate('CMO intelligence')}>
                    Open CMO intelligence
                    <ArrowRight size={17} />
                  </button>
                </section>
              </div>
              <div className="two-col">
                <Panel
                  title="Growth priorities"
                  subtitle="Your active experiments, ranked by ICE"
                  action={
                    <button className="text-btn" onClick={() => navigate('Experiments')}>
                      View backlog
                      <ArrowRight size={14} />
                    </button>
                  }
                >
                  {data.priorities.slice(0, 3).map((e, i) => (
                    <div className="priority-row" key={e.id}>
                      <span className="rank">0{i + 1}</span>
                      <div>
                        <strong>{e.title}</strong>
                        <small>
                          {e.channel} · {e.owner} · {e.isDemo ? 'DEMO' : 'Manual'}
                        </small>
                      </div>
                      <span className="score">
                        {e.score}
                        <small>ICE</small>
                      </span>
                    </div>
                  ))}
                  {!data.priorities.length && <Empty>No active experiments yet.</Empty>}
                </Panel>
                <Panel
                  title="Channel snapshot"
                  subtitle="Attributed acquisition · last 30 calendar days"
                  action={
                    <button className="text-btn" onClick={() => navigate('Channels')}>
                      Explore
                      <ArrowRight size={14} />
                    </button>
                  }
                >
                  {data.channels
                    .slice()
                    .sort((a, b) => b.subscribers - a.subscribers)
                    .slice(0, 4)
                    .map((c, i) => (
                      <div className="channel-row" key={c.id}>
                        <span className={`channel-dot color-${i}`} />
                        <div>
                          <strong>{c.name}</strong>
                          <div className="bar-track">
                            <i
                              style={{
                                width: `${Math.max(2, (c.subscribers / Math.max(...data.channels.map((ch) => ch.subscribers), 1)) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <span>
                          <strong>{c.subscribers}</strong>
                          <small>
                            {c.isDemo ? 'DEMO · ' : ''}
                            {c.cac == null ? 'No CAC' : `${money(c.cac)} CAC`}
                          </small>
                        </span>
                      </div>
                    ))}
                </Panel>
              </div>
              <div className="governance-strip">
                <ShieldCheck size={20} />
                <div>
                  <strong>Strategy with a human in control.</strong>
                  <p>
                    {pending} pending approval{pending !== 1 ? 's' : ''}. Recommendations never
                    trigger campaigns, spending, or publishing.
                  </p>
                </div>
                <button className="text-btn" onClick={() => navigate('Approvals')}>
                  Review requests
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}
          {tab === 'Daily metrics' && <Metrics data={data} mutate={mutate} />}
          {tab === 'Today' && <Today data={data} mutate={mutate} />}
          {tab === 'Channels' && <Channels data={data} mutate={mutate} />}
          {tab === 'Experiments' && <Experiments data={data} mutate={mutate} />}
          {tab === 'Knowledge base' && <Knowledge data={data} mutate={mutate} />}
          {tab === 'Institutional memory' && (
            <>
              <Editor
                title="Record company memory"
                subtitle="Persist a decision, observation, constraint, or lesson for future recommendations."
                fields={[
                  { name: 'title', label: 'Title' },
                  {
                    name: 'kind',
                    label: 'Memory type',
                    options: ['DECISION', 'LEARNING', 'CONSTRAINT', 'OBSERVATION'],
                  },
                  {
                    name: 'content',
                    label: 'Evidence, reasoning, and implications',
                    type: 'textarea',
                  },
                ]}
                onSave={(v) => mutate('memories', v)}
              />
              <div className="cards-grid">
                {data.memories.map((m) => (
                  <Panel key={m.id} title={m.title} action={<Demo value={m.isDemo} />}>
                    <div className="record-body">
                      <Badge>{m.kind}</Badge>
                      <p>{m.content}</p>
                      <small>{dateLabel(m.createdAt)}</small>
                    </div>
                  </Panel>
                ))}
              </div>
            </>
          )}
          {tab === 'CMO intelligence' && <Chat data={data} mutate={mutate} />}
          {tab === 'Briefs & plans' && <Reports data={data} mutate={mutate} />}
          {tab === 'Forecast' && (
            <>
              <div className="stats-grid">
                <Stat
                  label="CURRENT SUBSCRIBERS"
                  value={number(s.current)}
                  detail={`Status: ${s.status}`}
                  icon={Target}
                />
                {(['downside', 'base', 'upside'] as const).map((kind, i) => (
                  <Stat
                    key={kind}
                    label={`${kind.toUpperCase()} SCENARIO`}
                    value={number(s.forecasts[kind])}
                    detail={`${[65, 100, 135][i]}% of observed daily net additions`}
                    icon={TrendingUp}
                  />
                ))}
              </div>
              <Panel
                title="12-month subscriber trajectory"
                subtitle="Geometric target curve: start × (target / start) ^ elapsed fraction"
              >
                <TrendChart data={data} />
              </Panel>
              <Panel title="Model assumptions & limitations">
                <div className="record-body">
                  <p>
                    Target: {number(data.company.goalStart)} → {number(data.company.goalTarget)}{' '}
                    from {dateLabel(data.company.goalStartDate)} to{' '}
                    {dateLabel(data.company.goalEndDate)}. The target follows compounded growth;
                    scenarios use a separate linear run-rate model.
                  </p>
                  <p>
                    {s.sampleDays
                      ? `Observed net additions average ${s.averageNet.toFixed(2)}/day across`
                      : 'Forecast unavailable until comparable daily observations exist. Flow sample:'}{' '}
                    {s.sampleDays} reported dates in the 30-day window ending at the latest
                    observation. Missing dates are excluded; stale or sparse data reduces
                    confidence. Forecast = latest subscribers + observed average × scenario
                    multiplier × remaining days, floored at zero. It assumes steady net additions,
                    not guaranteed compound growth. No seasonal or causal effect is modeled.
                  </p>
                  <p>
                    Latest data age: {s.dataAgeDays ?? 'unknown'} days. All monetary values use USD.
                    Demo data is illustrative.
                  </p>
                </div>
              </Panel>
              <Panel title="Monthly milestones">
                <Table headings={['Milestone', 'Target date', 'Subscriber target']}>
                  {s.trajectory.map((p) => (
                    <tr key={p.month}>
                      <td>{p.month === 0 ? 'Starting point' : `Month ${p.month}`}</td>
                      <td>{dateLabel(p.date)}</td>
                      <td>{number(p.target)}</td>
                    </tr>
                  ))}
                </Table>
              </Panel>
            </>
          )}
          {tab === 'Alerts' && (
            <Panel
              title="Attention queue"
              subtitle="Historical alerts are retained; acknowledge reviewed signals. Pace alerts update after metric changes."
            >
              {data.alerts.map((a) => (
                <div className="alert-row" key={a.id}>
                  <div className={`alert-symbol ${a.severity === 'HIGH' ? 'high' : ''}`}>
                    <Bell size={18} />
                  </div>
                  <div>
                    <strong>{a.title}</strong>
                    <p>{a.detail}</p>
                    <small>
                      {dateLabel(a.createdAt)} · {a.severity} · {a.isDemo ? 'DEMO' : 'Observed'}
                    </small>
                  </div>
                  {a.acknowledged ? (
                    <Badge tone="green">Acknowledged</Badge>
                  ) : (
                    <AsyncButton action={() => mutate('alerts', { id: a.id })}>
                      Acknowledge
                    </AsyncButton>
                  )}
                </div>
              ))}
              {!data.alerts.length && <Empty>No alerts recorded.</Empty>}
            </Panel>
          )}
          {tab === 'Approvals' && <Approvals data={data} mutate={mutate} />}
          {tab === 'Audit log' && (
            <Panel
              title="Workspace activity"
              subtitle="Most recent 100 events. Append-only through the application."
            >
              <Table headings={['When', 'Actor', 'Action', 'Record', 'Details']}>
                {data.audits.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{new Date(a.createdAt).toLocaleString()}</td>
                    <td>{a.actor}</td>
                    <td>
                      <Badge>{a.action}</Badge>
                    </td>
                    <td>
                      {a.entityType}
                      <small className="block muted">{a.entityId}</small>
                    </td>
                    <td className="audit-details">{a.details}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )}
          {tab === 'CSV import' && <CsvImport mutate={mutate} />}
          {tab === 'Settings' && (
            <>
              <Editor
                key={data.company.updatedAt}
                title="Company & growth ambition"
                fields={[
                  { name: 'name', label: 'Company name', value: data.company.name },
                  {
                    name: 'description',
                    label: 'Company description',
                    type: 'textarea',
                    value: data.company.description,
                  },
                  {
                    name: 'goalStart',
                    label: 'Starting subscribers',
                    type: 'number',
                    value: data.company.goalStart,
                    min: 1,
                  },
                  {
                    name: 'goalTarget',
                    label: 'Target subscribers',
                    type: 'number',
                    value: data.company.goalTarget,
                    min: 1,
                  },
                  {
                    name: 'goalStartDate',
                    label: 'Goal start (UTC)',
                    type: 'date',
                    value: data.company.goalStartDate,
                  },
                  {
                    name: 'goalEndDate',
                    label: 'Goal end (UTC)',
                    type: 'date',
                    value: data.company.goalEndDate,
                  },
                ]}
                onSave={(v) => mutate('company', v)}
              />
              <Panel title="Sync schedule & history">
                <div className="record-body">
                  <p>
                    Automatic read-only sync: daily at 4:00 a.m. America/New_York (Eastern),
                    following daylight saving time. Configured Stripe, X, Instagram and Drive
                    connections are included.
                  </p>
                  <p>
                    The refresh icon only reloads the screen. Use Sync all to fetch new provider
                    data. Recent per-provider requests may be skipped during their cooldown.
                  </p>
                  {data.syncHistory.length ? (
                    data.syncHistory.map((run) => (
                      <div className="drive-document" key={run.id}>
                        <p>
                          <strong>
                            {run.trigger} · {run.status}
                          </strong>{' '}
                          · {new Date(run.startedAt).toLocaleString()}
                        </p>
                        {run.results.map((result) => (
                          <p key={result.provider}>
                            {result.provider}: <strong>{result.status}</strong> — {result.message}
                          </p>
                        ))}
                      </div>
                    ))
                  ) : (
                    <p>No full sync has run yet.</p>
                  )}
                </div>
              </Panel>
              <Panel title="Provider & integration status">
                <div className="record-body">
                  <p>
                    <strong>Intelligence:</strong> {data.provider}. OpenAI is optional; the local
                    provider produces deterministic evidence briefs without credentials. You can
                    explicitly select local mode for each generation.
                  </p>
                  <p>
                    <strong>Stripe:</strong>{' '}
                    {data.stripe.lastSync
                      ? `Last successful read: ${new Date(data.stripe.lastSync).toLocaleString()}`
                      : 'Not synced.'}
                  </p>
                  <p>
                    TradeLink product scope:{' '}
                    {data.stripe.products.join(', ') ||
                      'Not configured. Set verified STRIPE_PRODUCT_IDS in server settings.'}
                  </p>
                  <p>
                    Counts unique customers with active, unpaused, positive recurring-price
                    subscriptions. Trials, past-due, and free prices are excluded. Discounts do not
                    change this count.
                  </p>
                  <p>
                    New and churned are observed customer-set changes between consecutive UTC-date
                    snapshots, not Stripe lifecycle events. Intra-day changes and missing days
                    cannot be reconstructed. Manual and demo metric history is retained but excluded
                    from Stripe forecasts.
                  </p>
                  {data.stripe.summary && (
                    <>
                      <p>
                        Gross MRR: {money(data.stripe.summary.grossMrr ?? null)}. Before discounts,
                        tax, refunds, credits and fees; differs from Stripe net MRR.
                      </p>
                      <p>
                        Month-to-date paid invoice amount:{' '}
                        {money(data.stripe.summary.paidInvoiceAmountMonthToDate ?? null)} across{' '}
                        {data.stripe.summary.paidInvoicesMonthToDate} scoped invoices. Includes
                        taxes and out-of-band payments; excludes refunds, fees and mixed-product
                        invoices. This is not net revenue or cash reconciliation.
                      </p>
                      <p>
                        Active subscriptions: {data.stripe.summary.activeSubscriptions}; trials:{' '}
                        {data.stripe.summary.trialingSubscriptions}; past due:{' '}
                        {data.stripe.summary.pastDueSubscriptions}.
                      </p>
                      {data.stripe.summary.warnings?.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </>
                  )}
                  <StripeSync configured={data.stripe.configured} mutate={mutate} />
                  <p>
                    Read-only Stripe access. No webhook, scheduled job or billing changes are
                    enabled.
                  </p>
                  <p>
                    <strong>Social reporting:</strong>{' '}
                    {data.social
                      .map(
                        (c) =>
                          `${c.label}: ${c.lastSync ? 'last sync ' + new Date(c.lastSync).toLocaleString() : c.configured ? 'configured, not synced' : 'not connected'}`,
                      )
                      .join(' · ')}
                  </p>
                  <button className="btn" onClick={() => navigate('Channels')}>
                    Open social reporting
                  </button>
                  <p>
                    <strong>Actions:</strong> No external executor is present in V1. Approved
                    requests remain unexecuted.
                  </p>
                </div>
              </Panel>
            </>
          )}
          <footer className="page-footer">
            <span>
              TradeLink CMO OS <span className="muted">/</span> Evidence over guesswork.
            </span>
            <span>
              <ShieldCheck size={12} />
              Internal use only · Human approval required
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon: Icon,
  tone = '',
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: string;
}) {
  return (
    <div className={`stat-card ${tone}`}>
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}
function Table({ headings, children }: { headings: string[]; children: ReactNode }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headings.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
type Mutate = (resource: string, body: Record<string, unknown>) => Promise<void>;
const today = () => new Date().toISOString().slice(0, 10);
function Metrics({ data, mutate }: { data: Data; mutate: Mutate }) {
  const [editDate, setEditDate] = useState(today());
  const m = data.metrics.find((m) => m.date === editDate);
  return (
    <>
      <div className="section-tools">
        <label>
          Observation date
          <input
            aria-label="Observation date"
            type="date"
            value={editDate}
            onChange={(e) => setEditDate(e.target.value)}
          />
        </label>
      </div>
      <Editor
        key={editDate}
        title={m ? 'Update daily observation' : 'Add daily observation'}
        subtitle="Edits save manual records only. Stripe snapshots are separate and take precedence in the dashboard once synced."
        fields={[
          { name: 'date', label: 'Date (UTC)', type: 'date', value: editDate },
          ...(['subscribers', 'newSubs', 'churned', 'visitors', 'mrr', 'spend'] as const).map(
            (name) => ({
              name,
              label: {
                subscribers: 'Total subscribers',
                newSubs: 'New subscribers',
                churned: 'Churned subscribers',
                visitors: 'Visitors',
                mrr: 'MRR (USD)',
                spend: 'Daily spend (USD)',
              }[name],
              type: 'number',
              value: m?.[name] ?? 0,
            }),
          ),
        ]}
        onSave={(v) => mutate('metrics', v)}
      />
      <Panel
        title="Daily observations"
        subtitle="Stripe rows are read-only snapshots; MRR is gross. Dashes mean unavailable. New/churned are observed changes between consecutive daily snapshots. Manual inputs are retained separately."
      >
        <Table
          headings={[
            'Date',
            'Subscribers',
            'New',
            'Churned',
            'Visitors',
            'MRR',
            'Spend',
            'Source',
            '',
          ]}
        >
          {data.metrics
            .slice()
            .reverse()
            .map((m) => (
              <tr key={m.id}>
                <td>{dateLabel(m.date)}</td>
                <td>
                  <strong>{number(m.subscribers)}</strong>
                </td>
                <td className="green-text">{m.newSubs === null ? '—' : `+${m.newSubs}`}</td>
                <td>{number(m.churned)}</td>
                <td>{number(m.visitors)}</td>
                <td>{money(m.mrr)}</td>
                <td>{money(m.spend)}</td>
                <td>{m.source === 'stripe' ? 'Stripe · gross MRR' : <Demo value={m.isDemo} />}</td>
                <td>
                  {m.source !== 'stripe' && (
                    <button className="text-btn" onClick={() => setEditDate(m.date)}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
        </Table>
      </Panel>
    </>
  );
}
function Channels({ data, mutate }: { data: Data; mutate: Mutate }) {
  return (
    <>
      <SocialReporting data={data} mutate={mutate} />
      <XAdsReporting data={data} mutate={mutate} />
      <Panel
        title="Channel performance"
        subtitle="Last 30 calendar days. CAC = recorded spend / attributed subscribers; conversion = subscribers / visitors."
      >
        <Table
          headings={[
            'Channel',
            'Visitors',
            'Leads',
            'Subscribers',
            'Spend',
            'CAC',
            'Conversion',
            'Data',
          ]}
        >
          {data.channels.map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.name}</strong>
              </td>
              <td>{number(c.visitors)}</td>
              <td>{number(c.leads)}</td>
              <td>{number(c.subscribers)}</td>
              <td>{money(c.spend)}</td>
              <td>{c.cac == null ? '—' : money(c.cac)}</td>
              <td>{c.conversion == null ? '—' : c.conversion.toFixed(1) + '%'}</td>
              <td>
                <Demo value={c.isDemo} />
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Editor
        title="Record a channel observation"
        subtitle="Use the same channel name and date to update an observation. Attribution may overlap across channels."
        fields={[
          { name: 'name', label: 'Channel name', value: 'Organic search' },
          { name: 'date', label: 'Date (UTC)', type: 'date', value: today() },
          ...['visitors', 'leads', 'subscribers', 'spend'].map((name) => ({
            name,
            label: name === 'spend' ? 'Spend (USD)' : name[0].toUpperCase() + name.slice(1),
            type: 'number',
            value: 0,
          })),
        ]}
        onSave={(v) => mutate('channels', v)}
      />
    </>
  );
}
function Experiments({ data, mutate }: { data: Data; mutate: Mutate }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <>
      <Panel
        title="Experiment backlog"
        subtitle="ICE score = impact × confidence × ease. Each dimension is rated 1–10."
      >
        <Table headings={['Experiment', 'Channel / owner', 'ICE', 'Status', 'Data', '']}>
          {data.experiments
            .slice()
            .sort((a, b) => b.impact * b.confidence * b.ease - a.impact * a.confidence * a.ease)
            .map((e) => (
              <tr key={e.id}>
                <td>
                  <strong>{e.title}</strong>
                  <small className="block muted">{e.successMetric}</small>
                </td>
                <td>
                  {e.channel}
                  <small className="block muted">{e.owner}</small>
                </td>
                <td>
                  <strong>{e.impact * e.confidence * e.ease}</strong>
                </td>
                <td>
                  <Badge tone={e.status === 'RUNNING' ? 'green' : ''}>{e.status}</Badge>
                </td>
                <td>
                  <Demo value={e.isDemo} />
                </td>
                <td>
                  <button
                    className="text-btn"
                    onClick={() => setEditing(editing === e.id ? null : e.id)}
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
        </Table>
      </Panel>
      {editing &&
        (() => {
          const e = data.experiments.find((e) => e.id === editing)!;
          return (
            <Editor
              key={e.id}
              title={e.title}
              subtitle={e.hypothesis}
              fields={[
                {
                  name: 'status',
                  label: 'Status',
                  options: ['BACKLOG', 'RUNNING', 'COMPLETED', 'CANCELLED'],
                  value: e.status,
                },
                {
                  name: 'result',
                  label: 'Result / evidence / next step',
                  type: 'textarea',
                  value: e.result,
                  required: false,
                },
              ]}
              onSave={(v) => mutate('experiments', { ...v, id: e.id })}
              button="Save review"
            >
              <p className="muted">
                Completing an experiment also records an institutional learning.
              </p>
            </Editor>
          );
        })()}
      <Editor
        title="Design an experiment"
        fields={[
          { name: 'title', label: 'Experiment title' },
          { name: 'hypothesis', label: 'Testable hypothesis', type: 'textarea' },
          { name: 'channel', label: 'Channel' },
          { name: 'owner', label: 'Owner' },
          { name: 'successMetric', label: 'Success metric & time window' },
          ...['impact', 'confidence', 'ease'].map((name) => ({
            name,
            label: name[0].toUpperCase() + name.slice(1) + ' (1–10)',
            type: 'number',
            value: 5,
            min: 1,
            max: 10,
          })),
        ]}
        onSave={(v) => mutate('experiments', v)}
        button="Add to backlog"
      />
    </>
  );
}
function Knowledge({ data, mutate }: { data: Data; mutate: Mutate }) {
  const [editing, setEditing] = useState<string | null>(null);
  const k = data.knowledge.find((k) => k.id === editing);
  return (
    <>
      <DriveKnowledge data={data} mutate={mutate} />
      <div className="cards-grid">
        {data.knowledge.map((k) => (
          <Panel key={k.id} title={k.title} action={<Demo value={k.isDemo} />}>
            <div className="record-body">
              <Badge>{k.category}</Badge>
              <p>{k.content}</p>
              <div className="record-footer">
                <small>Updated {dateLabel(k.updatedAt)}</small>
                <button className="text-btn" onClick={() => setEditing(k.id)}>
                  Edit knowledge
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </Panel>
        ))}
      </div>
      <Editor
        key={editing || 'new'}
        title={k ? 'Edit company knowledge' : 'Add company knowledge'}
        subtitle="Saved knowledge is included in CMO context. Replace demo assumptions with approved company facts."
        fields={[
          { name: 'title', label: 'Title', value: k?.title },
          {
            name: 'category',
            label: 'Category',
            options: ['Company', 'Audience', 'Product', 'Positioning', 'Constraints', 'Other'],
            value: k?.category,
          },
          {
            name: 'content',
            label: 'Facts, evidence, and relevant constraints',
            type: 'textarea',
            value: k?.content,
          },
        ]}
        onSave={async (v) => {
          await mutate('knowledge', { ...v, ...(k ? { id: k.id } : {}) });
          setEditing(null);
        }}
        button={k ? 'Save knowledge' : 'Add knowledge'}
      >
        {k && (
          <button type="button" className="text-btn" onClick={() => setEditing(null)}>
            Cancel editing
          </button>
        )}
      </Editor>
    </>
  );
}
function AsyncButton({ action, children }: { action: () => Promise<void>; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await action();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Working…' : children}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function Chat({ data, mutate }: { data: Data; mutate: Mutate }) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const questions = [
    'Are we ahead or behind pace toward 5,000 subscribers?',
    'What are the highest-priority growth actions?',
    'What have we learned from our experiments and decisions?',
  ];
  async function send(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate('chat', { prompt: question, type: 'CHAT', mode });
      setPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="chat-layout">
      <Panel
        title="CMO conversation"
        subtitle="Grounded in your stored company evidence"
        action={
          <Badge tone="green">
            <Sparkles size={12} />
            {data.provider}
          </Badge>
        }
      >
        <div className="chat-messages" aria-live="polite">
          {!data.messages.length && (
            <div className="chat-welcome">
              <span className="spark-icon">
                <Sparkles size={28} />
              </span>
              <h2>Let’s move growth forward.</h2>
              <p>
                I can assess your pace, surface the next best experiment, and connect today’s
                signals to your company’s knowledge.
              </p>
              {questions.map((q) => (
                <button key={q} onClick={() => send(q)} disabled={busy}>
                  {q}
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          )}
          {data.messages.map((m) => (
            <div key={m.id} className={`message ${m.role}`}>
              <div className="message-meta">
                {m.role === 'user' ? 'YOU' : 'CMO INTELLIGENCE'}{' '}
                <span>
                  {m.provider !== 'manual' && m.provider} {m.isDemo && '· DEMO CONTEXT'}
                </span>
              </div>
              <MarkdownText content={m.content} />
            </div>
          ))}
          {busy && <p className="muted">Reviewing your stored operating evidence…</p>}
        </div>
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(prompt);
          }}
        >
          <label className="sr-only" htmlFor="chat-prompt">
            Ask your CMO
          </label>
          <textarea
            id="chat-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={4000}
            placeholder="Ask about growth, priorities, or a decision…"
            rows={3}
            required
          />
          <div>
            <select
              aria-label="Intelligence provider"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="auto">
                {data.provider === 'OpenAI' ? 'OpenAI' : 'Local evidence'} mode
              </option>
              <option value="local">Force local evidence</option>
            </select>
            <button className="btn primary" disabled={busy || !prompt.trim()}>
              Ask CMO
              <ArrowRight size={15} />
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </Panel>
      <div>
        <Panel title="Connected company context" subtitle="Evidence available for every answer">
          <div className="context-list">
            {[
              [BookOpen, 'Knowledge records', data.knowledge.length],
              [Activity, 'Daily observations', data.metrics.length],
              [FlaskConical, 'Experiments', data.experiments.length],
              [History, 'Memory records', data.memories.length],
              [
                ClipboardCheck,
                'Reviewed decisions',
                data.approvals.filter((a) => a.status !== 'PENDING').length,
              ],
            ].map(([Icon, label, count]) => {
              const I = Icon as LucideIcon;
              return (
                <div key={String(label)}>
                  <I size={17} />
                  <span>{String(label)}</span>
                  <strong>{String(count)}</strong>
                </div>
              );
            })}
          </div>
        </Panel>
        <div className="helper-note">
          <ShieldCheck size={20} />
          <h4>A strategist, with boundaries.</h4>
          <p>
            Answers can propose actions. They cannot spend money, send messages, or publish. Every
            external action needs human approval and manual execution.
          </p>
          <p>
            Local evidence mode is a transparent, deterministic briefing engine. OpenAI enables
            free-form reasoning when you connect a key.
          </p>
        </div>
      </div>
    </div>
  );
}
function MarkdownText({ content }: { content: string }) {
  return (
    <div className="markdown">
      {content
        .split('\n')
        .map((line, i) =>
          line.startsWith('### ') ? (
            <h4 key={i}>{line.slice(4)}</h4>
          ) : line.startsWith('## ') ? (
            <h4 key={i}>{line.slice(3)}</h4>
          ) : line.startsWith('# ') ? (
            <h3 key={i}>{line.slice(2)}</h3>
          ) : line.trim() ? (
            <p key={i}>{line}</p>
          ) : null,
        )}
    </div>
  );
}
function Reports({ data, mutate }: { data: Data; mutate: Mutate }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState('auto');
  const report = data.reports.find((r) => r.id === selected) || data.reports[0];
  return (
    <>
      <div className="section-tools">
        <label>
          Intelligence provider
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="auto">{data.provider}</option>
            <option value="local">Local evidence</option>
          </select>
        </label>
      </div>
      <div className="report-generators">
        {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((type, i) => (
          <Panel
            key={type}
            title={['Daily Growth Brief', 'Weekly CMO Review', 'Monthly Growth Plan'][i]}
            subtitle={
              [
                'Today’s pace, signals, and next actions.',
                'Performance, experiments, decisions, and learnings.',
                'Targets, priorities, and a four-week operating plan.',
              ][i]
            }
          >
            <div className="record-body">
              <AsyncButton
                action={async () => {
                  await mutate('reports', {
                    type,
                    prompt: `Generate the ${type.toLowerCase()} operating briefing from current evidence.`,
                    mode,
                  });
                  setSelected(null);
                }}
              >
                <Sparkles size={15} />
                Generate {['brief', 'review', 'plan'][i]}
              </AsyncButton>
            </div>
          </Panel>
        ))}
      </div>
      <div className="reports-layout">
        <Panel title="Saved briefings" subtitle="Persistent, point-in-time records">
          {data.reports.map((r) => (
            <button
              key={r.id}
              className={`report-link ${report?.id === r.id ? 'selected' : ''}`}
              onClick={() => setSelected(r.id)}
            >
              <FileText size={17} />
              <span>
                <strong>{r.title}</strong>
                <small>
                  {r.provider} · {r.isDemo ? 'DEMO context' : 'Manual context'}
                </small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
          {!data.reports.length && (
            <Empty>Generate a briefing to start your operating history.</Empty>
          )}
        </Panel>
        {report ? (
          <Panel
            title={report.title}
            subtitle={`${report.provider} · ${dateLabel(report.createdAt)}`}
            action={<Demo value={report.isDemo} />}
          >
            <div className="report-content">
              <MarkdownText content={report.content} />
            </div>
          </Panel>
        ) : (
          <Panel title="Your next operating brief">
            <Empty>
              Select a cadence above to generate a grounded briefing from your stored company data.
            </Empty>
          </Panel>
        )}
      </div>
    </>
  );
}
function Approvals({ data, mutate }: { data: Data; mutate: Mutate }) {
  return (
    <>
      <div className="safety-banner">
        <ShieldCheck size={20} />
        <p>
          <strong>Approval records a decision. It does not execute an action.</strong> V1 has no
          external action runner. Approved requests must be carried out manually by an authorized
          person.
        </p>
      </div>
      <div className="cards-grid">
        {data.approvals.map((a) => (
          <Panel
            key={a.id}
            title={a.title}
            action={
              <Badge
                tone={a.status === 'APPROVED' ? 'green' : a.status === 'PENDING' ? 'amber' : ''}
              >
                {a.status}
              </Badge>
            }
          >
            <div className="record-body">
              <div className="inline-badges">
                <Badge>{a.actionType}</Badge>
                <Demo value={a.isDemo} />
              </div>
              <p>{a.details}</p>
              <small>
                Requested by {a.requestedBy} · {dateLabel(a.createdAt)}
              </small>
              {a.status === 'PENDING' ? (
                <ApprovalReview id={a.id} mutate={mutate} />
              ) : (
                <div className="review-result">
                  <strong>{a.reviewedBy}</strong>
                  <p>{a.reviewNote}</p>
                  <small>Recorded decision only · Not executed</small>
                </div>
              )}
            </div>
          </Panel>
        ))}
      </div>
      <Editor
        title="Request human approval"
        fields={[
          { name: 'title', label: 'Proposed action' },
          {
            name: 'actionType',
            label: 'Action type',
            options: ['CAMPAIGN', 'BUDGET', 'CONTENT', 'INTEGRATION', 'OTHER'],
          },
          {
            name: 'details',
            label: 'Rationale, budget, scope, risks, and expected outcome',
            type: 'textarea',
          },
        ]}
        onSave={(v) => mutate('approvals', v)}
        button="Submit for review"
      />
    </>
  );
}
function ApprovalReview({ id, mutate }: { id: string; mutate: Mutate }) {
  const [note, setNote] = useState('');
  return (
    <div className="approval-review">
      <label>
        Decision rationale
        <textarea
          aria-label="Decision rationale"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={5000}
        />
      </label>
      <div className="inline-buttons">
        <AsyncButton
          action={async () => {
            if (!note.trim()) throw new Error('Enter a decision rationale first.');
            await mutate('approvals', { id, status: 'APPROVED', reviewNote: note });
          }}
        >
          <Check size={14} />
          Approve request
        </AsyncButton>
        <AsyncButton
          action={async () => {
            if (!note.trim()) throw new Error('Enter a decision rationale first.');
            await mutate('approvals', { id, status: 'REJECTED', reviewNote: note });
          }}
        >
          Reject
        </AsyncButton>
      </div>
    </div>
  );
}
function CsvImport({ mutate }: { mutate: Mutate }) {
  const [csv, setCsv] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  function download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob(
        ['date,subscribers,newSubs,churned,visitors,mrr,spend\n2026-01-01,50,3,1,250,950,45\n'],
        { type: 'text/csv' },
      ),
    );
    a.download = 'tradelink-metrics-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <>
      <Panel
        title="Import daily metrics"
        subtitle="Up to 1,000 rows / 500 KB. All rows validate before the transaction is committed."
        action={
          <button className="btn" onClick={download}>
            <Download size={15} />
            Template
          </button>
        }
      >
        <div className="record-body">
          <label className="file-drop">
            <Upload size={26} />
            <strong>Choose a metrics CSV</strong>
            <small>UTF-8 · required headers shown below</small>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setError('');
                if (!f) return;
                if (f.size > 500000) {
                  setError('CSV exceeds 500 KB.');
                  return;
                }
                setCsv(await f.text());
              }}
            />
          </label>
          <p className="code-block">date,subscribers,newSubs,churned,visitors,mrr,spend</p>
          <label>
            CSV content / preview
            <textarea
              aria-label="CSV content"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={9}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Explicitly overwrite existing dates and replace demo labels with manual CSV data
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <AsyncButton
            action={async () => {
              await mutate('import', { csv, overwrite });
              setMessage('Import completed. Validated observations are saved in PostgreSQL.');
            }}
          >
            <Upload size={15} />
            Validate & import
          </AsyncButton>
          <p className="success" role="status">
            {message}
          </p>
          <p className="muted">
            Dates must use YYYY-MM-DD. Counts are nonnegative integers; currency values are
            nonnegative USD amounts. Duplicate dates within a file are rejected. Invalid imports
            leave all data unchanged.
          </p>
        </div>
      </Panel>
    </>
  );
}

function StripeSync({ configured, mutate }: { configured: boolean; mutate: Mutate }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <>
      <button
        className="btn"
        disabled={!configured || busy}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            await mutate('stripe-sync', {});
            setMessage('Stripe snapshot saved.');
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Stripe sync failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Reading Stripe…' : 'Sync Stripe read-only'}
      </button>
      {!configured && (
        <p>
          Requires a restricted live key and verified TradeLink product IDs in server configuration.
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </>
  );
}

function SocialReporting({ data, mutate }: { data: Data; mutate: Mutate }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  return (
    <>
      <div className="safety-banner">
        <p>
          Social reporting is read-only. Followers, views and engagement are not attributed website
          visitors or paid subscribers. Use tracked links and website analytics to measure
          conversion. Use Sync all or the daily 4 a.m. Eastern sync. No publishing or messaging is
          available.
        </p>
      </div>
      {message && (
        <p role="status" className="social-status">
          {message}
        </p>
      )}
      <div className="two-col">
        {data.social.map((connection) => {
          const snapshot = connection.snapshot;
          const history = connection.history;
          const first = history[0];
          const last = history.at(-1);
          const movement =
            history.length > 1 && first?.followers !== null && last?.followers !== null
              ? last!.followers! - first!.followers!
              : null;
          return (
            <Panel
              key={connection.provider}
              title={`${connection.label} reporting`}
              subtitle={
                snapshot
                  ? `@${snapshot.username} · Live API snapshot · ${new Date(snapshot.capturedAt).toLocaleString()}`
                  : 'Not connected — no successful sync yet.'
              }
            >
              <div className="record-body">
                <p>
                  {connection.configured
                    ? 'Credentials configured; verify the account and sync result below.'
                    : 'Add the account access token and numeric user ID in Railway to connect.'}
                </p>
                <button
                  className="btn primary"
                  disabled={!connection.configured || busy !== null}
                  onClick={async () => {
                    setBusy(connection.provider);
                    setMessage('');
                    try {
                      await mutate('social-sync', { provider: connection.provider });
                      setMessage(`${connection.label} snapshot saved.`);
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : 'Social sync failed.');
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === connection.provider
                    ? 'Reading account…'
                    : `Sync ${connection.label} read-only`}
                </button>
                {snapshot && (
                  <>
                    <p>
                      <strong>{number(snapshot.followers)}</strong> followers ·{' '}
                      <strong>{number(snapshot.totalPosts)}</strong> total account posts
                    </p>
                    {movement !== null && (
                      <p>
                        Observed follower change: {movement >= 0 ? '+' : ''}
                        {number(movement)} between{' '}
                        {new Date(first!.capturedAt).toLocaleDateString()} and{' '}
                        {new Date(last!.capturedAt).toLocaleDateString()}. Not a daily rate.
                      </p>
                    )}
                    {connection.isStale && (
                      <p className="badge amber">Snapshot is over 24 hours old. Sync to refresh.</p>
                    )}
                    {snapshot.notes.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </>
                )}
              </div>
              {snapshot && (
                <Table headings={['Post / UTC date', 'Likes', 'Comments', 'Shares', 'Views']}>
                  {snapshot.posts.length ? (
                    snapshot.posts.map((post) => (
                      <tr key={post.id}>
                        <td className="social-post">
                          <strong>{post.text || '(No caption)'}</strong>
                          <small className="block">
                            {post.publishedAt.slice(0, 10)} · ID {post.id}
                          </small>
                        </td>
                        <td>{number(post.likes)}</td>
                        <td>{number(post.comments)}</td>
                        <td>{number(post.shares)}</td>
                        <td>{number(post.views)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>No posts returned by the API.</td>
                    </tr>
                  )}
                </Table>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}

function DriveKnowledge({ data, mutate }: { data: Data; mutate: Mutate }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const drive = data.drive;
  return (
    <Panel
      title="Google Drive reference folder"
      subtitle={drive.folderName || 'TradeLink folder — authorization required'}
    >
      <div className="record-body">
        <p>
          <a href={drive.folderUrl} target="_blank" rel="noopener noreferrer" className="text-btn">
            Open the approved Drive folder <ArrowRight size={14} />
          </a>
        </p>
        <p>
          Read-only import of Google Docs, plain text and Markdown, including nested folders. PDFs,
          Word files, Sheets, Slides, images and shortcuts are skipped. Edit originals in Drive,
          then sync here.
        </p>
        <p>
          {drive.lastSync
            ? `Last successful sync: ${new Date(drive.lastSync).toLocaleString()}. ${drive.skipped} unsupported files skipped.`
            : 'No successful Drive import yet.'}
        </p>
        {!drive.configured && (
          <p>
            Share this private folder with the dedicated service-account email as Viewer, then save
            its JSON credential in Railway. Do not make the folder public.
          </p>
        )}
        {drive.failed && (
          <p className="error">
            Last import failed. Previously imported content is retained but excluded from new CMO
            answers until a successful sync.
          </p>
        )}
        <button
          className="btn primary"
          disabled={!drive.configured || busy}
          onClick={async () => {
            setBusy(true);
            setMessage('');
            try {
              await mutate('drive-sync', {});
              setMessage('Drive references synced.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Drive sync failed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Reading Drive…' : 'Sync Drive read-only'}
        </button>
        {message && <p role="status">{message}</p>}
        <p>
          CMO answers use up to eight relevant document excerpts, with source links. This is not a
          full-folder review. Imported content is sent to OpenAI when you choose that provider.
        </p>
        {drive.available && !drive.documents.length && (
          <p>No supported documents were found in the last successful import.</p>
        )}
        {drive.documents.map((doc) => (
          <details className="drive-document" key={doc.fileId}>
            <summary>
              {doc.name}
              {doc.truncated ? ' · import truncated at 20,000 characters' : ''}
            </summary>
            <p>
              <a
                href={doc.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-btn"
              >
                Open source document <ArrowRight size={13} />
              </a>
              <small className="block">
                {doc.path} · Source modified {new Date(doc.modifiedAt).toLocaleString()}
              </small>
            </p>
            <div className="drive-content">{doc.content || '(Empty document)'}</div>
          </details>
        ))}
      </div>
    </Panel>
  );
}

function SyncAllButton({ mutate }: { mutate: Mutate }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <div className="sync-all-control">
      <button
        className={`btn ${busy ? 'spin' : ''}`}
        aria-label="Sync all data"
        disabled={busy}
        title="Fetch fresh data from all configured providers"
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            await mutate('sync-all', {});
            setMessage('Sync finished. See Settings for each provider’s result.');
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Sync failed. Check Settings.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <RefreshCw size={15} />
        <span className="sync-all-label">{busy ? 'Syncing…' : 'Sync all'}</span>
      </button>
      {message && (
        <div className="sync-all-notice" role="status">
          {message}
          <button className="text-btn" onClick={() => setMessage('')}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function XAdsReporting({ data, mutate }: { data: Data; mutate: Mutate }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const connection = data.xAds,
    snapshot = connection.snapshot;
  const money = (value: number | null) =>
    value === null
      ? 'Unavailable'
      : snapshot?.currency
        ? new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: snapshot.currency,
          }).format(value)
        : `${value.toFixed(2)} (currency unavailable)`;
  const ratio = (numerator: number | null, denominator: number | null, scale = 1) =>
    numerator === null || denominator === null || denominator === 0
      ? null
      : (numerator / denominator) * scale;
  return (
    <Panel title="X paid advertising" subtitle="Read-only reporting · separate from organic X">
      <div className="record-body">
        <p>
          Advertiser account: {connection.accountId || 'Not configured'}. {connection.note}
        </p>
        <p>
          {connection.configured
            ? 'OAuth credentials configured. Sync to verify Ads API access.'
            : 'Authorization required: add dedicated X Ads user-context OAuth credentials in Railway. Your organic X token is separate.'}
        </p>
        <button
          className="btn primary"
          disabled={!connection.configured || busy}
          onClick={async () => {
            setBusy(true);
            setMessage('');
            try {
              await mutate('x-ads-sync', {});
              setMessage('Paid X snapshot saved.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'X Ads sync failed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Reading paid reporting…' : 'Sync X Ads read-only'}
        </button>
        {message && <p role="status">{message}</p>}
        {snapshot && (
          <>
            <p>
              <strong>{snapshot.accountName}</strong> · {snapshot.startTime.slice(0, 10)} through{' '}
              {snapshot.endTime.slice(0, 10)} (exclusive), UTC · Captured{' '}
              {new Date(snapshot.capturedAt).toLocaleString()} · Account timezone:{' '}
              {snapshot.timezone}
            </p>
            {connection.isStale && <p className="badge amber">Snapshot is over 24 hours old.</p>}
            {!connection.configured && (
              <p className="badge amber">
                Credentials unavailable. Showing previously stored data.
              </p>
            )}
            <p>
              Spend: <strong>{money(snapshot.totals.spend)}</strong> · Impressions:{' '}
              {number(snapshot.totals.impressions)} · Clicks (all): {number(snapshot.totals.clicks)}{' '}
              · URL clicks: {number(snapshot.totals.urlClicks)} · Engagements:{' '}
              {number(snapshot.totals.engagements)}
            </p>
            <p>
              URL CTR:{' '}
              {ratio(snapshot.totals.urlClicks, snapshot.totals.impressions, 100) === null
                ? 'Unavailable'
                : `${ratio(snapshot.totals.urlClicks, snapshot.totals.impressions, 100)!.toFixed(2)}%`}{' '}
              · Cost per URL click: {money(ratio(snapshot.totals.spend, snapshot.totals.urlClicks))}{' '}
              · CPM: {money(ratio(snapshot.totals.spend, snapshot.totals.impressions, 1000))}
            </p>
            {snapshot.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </>
        )}
      </div>
      {snapshot && (
        <Table
          headings={['Campaign', 'Status', 'Spend', 'Impressions', 'All clicks', 'URL clicks']}
        >
          {snapshot.campaigns.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.status}</td>
              <td>{money(c.spend)}</td>
              <td>{number(c.impressions)}</td>
              <td>{number(c.clicks)}</td>
              <td>{number(c.urlClicks)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}
