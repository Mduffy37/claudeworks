import React, { useState, useEffect } from "react";
import type { AnalyticsData, ActiveSession, Profile } from "../../electron/types";

interface Props {
  profiles: Profile[];
  onSelectProfile: (name: string) => void;
  onLaunch: (name: string, directory?: string) => void;
}

function fillDays(data: AnalyticsData["dailyActivity"], days: number): AnalyticsData["dailyActivity"] {
  if (data.length === 0) return [];
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  const map = new Map(data.map((d) => [d.date, d.messages]));
  const filled: AnalyticsData["dailyActivity"] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    filled.push({ date: key, messages: map.get(key) ?? 0 });
  }
  return filled;
}

function ActivityChart({ data, days }: { data: AnalyticsData["dailyActivity"]; days?: number }) {
  const [hovered, setHovered] = useState<{ date: string; messages: number; x: number; y: number } | null>(null);
  const filled = days ? fillDays(data, days) : data;
  if (filled.length === 0) return null;
  const max = Math.max(...filled.map((d) => d.messages), 1);

  return (
    <div className="home-chart">
      <div className="home-chart-bars">
        {filled.map((d) => (
          <div
            key={d.date}
            className="home-chart-col"
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHovered({ date: d.date, messages: d.messages, x: rect.left + rect.width / 2, y: rect.top });
            }}
            onMouseLeave={() => setHovered(null)}
          >
            <div
              className={`home-chart-bar${d.messages === 0 ? " empty" : ""}`}
              style={{ height: d.messages > 0 ? `${(d.messages / max) * 100}%` : "2px" }}
            />
            <div className="home-chart-label">
              {new Date(d.date + "T12:00:00").toLocaleDateString("en", { day: "numeric" })}
            </div>
          </div>
        ))}
      </div>
      {hovered && (
        <div className="home-chart-tooltip" style={{ left: hovered.x, top: hovered.y }}>
          <div className="home-chart-tooltip-date">
            {new Date(hovered.date + "T12:00:00").toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}
          </div>
          <div className="home-chart-tooltip-value">
            {hovered.messages.toLocaleString()} message{hovered.messages !== 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type TimePeriod = "7d" | "30d" | "all";

function periodToSince(period: TimePeriod): number | undefined {
  if (period === "all") return undefined;
  const now = Date.now();
  if (period === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  return now - 30 * 24 * 60 * 60 * 1000;
}

async function launchWithDirPicker(name: string, directory: string | undefined, onLaunch: Props["onLaunch"]) {
  let dir = directory;
  if (!dir) {
    const picked = await window.api.selectDirectory();
    if (!picked) return;
    dir = picked;
  }
  onLaunch(name, dir);
}

export function Home({ profiles, onSelectProfile, onLaunch }: Props) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>("30d");
  const [updateInfo, setUpdateInfo] = useState<{ available: boolean; current: string; latest: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      window.api.getAnalytics(periodToSince(period)),
      window.api.getActiveSessions(),
    ]).then(([analyticsData, sessions]) => {
      setAnalytics(analyticsData);
      setActiveSessions(sessions);
      setLoading(false);
    });
  }, [period]);

  useEffect(() => {
    window.api.checkForAppUpdate().then(setUpdateInfo);
  }, []);

  if (loading) {
    return (
      <div className="home">
        <div className="home-loading">Loading analytics...</div>
      </div>
    );
  }

  if (!analytics) return null;

  return (
    <div className="home">
      {/* Time period toggle */}
      <div className="home-period-toggle">
        {(["7d", "30d", "all"] as const).map((p) => (
          <button
            key={p}
            className={`home-period-btn${period === p ? " active" : ""}`}
            onClick={() => setPeriod(p)}
          >
            {p === "all" ? "All Time" : p === "7d" ? "7 Days" : "30 Days"}
          </button>
        ))}
      </div>

      {/* Update banner */}
      {updateInfo?.available && (
        <div className="home-update-banner">
          <span>Update available: v{updateInfo.latest}</span>
          <span className="home-update-current">Current: v{updateInfo.current}</span>
        </div>
      )}

      {/* Favourites */}
      {profiles.some((p) => p.favourite) && (
        <div className="home-section">
          <h3 className="home-section-title">Favourites</h3>
          <div className="home-favourites">
            {profiles.filter((p) => p.favourite).map((p) => (
              <div
                key={p.name}
                className="home-fav-card"
                onClick={() => onSelectProfile(p.name)}
              >
                <div className="home-profile-icon">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="home-profile-info">
                  <div className="home-profile-name">{p.name}</div>
                  <div className="home-profile-meta">
                    {p.plugins.length} plugin{p.plugins.length !== 1 ? "s" : ""}
                  </div>
                </div>
                <button
                  className="home-launch-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    launchWithDirPicker(p.name, p.directory, onLaunch);
                  }}
                  title="Launch profile"
                >
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="home-stats">
        <div className="home-stat">
          <div className="home-stat-value">{analytics.totalSessions.toLocaleString()}</div>
          <div className="home-stat-label">Sessions</div>
        </div>
        <div className="home-stat">
          <div className="home-stat-value">{analytics.totalMessages.toLocaleString()}</div>
          <div className="home-stat-label">Messages</div>
        </div>
        <div className="home-stat">
          <div className="home-stat-value">{analytics.topProjects.length}</div>
          <div className="home-stat-label">Projects</div>
        </div>
        <div className="home-stat">
          <div className="home-stat-value">{profiles.length}</div>
          <div className="home-stat-label">Profiles</div>
        </div>
      </div>

      {/* Active sessions */}
      {activeSessions.length > 0 && (
        <div className="home-section">
          <h3 className="home-section-title">Active Sessions ({activeSessions.length})</h3>
          <div className="home-active-list">
            {activeSessions.map((s) => (
              <div key={s.pid} className="home-active-item">
                <div className="home-active-dot" />
                <div className="home-active-info">
                  <span className="home-active-profile">{s.profile}</span>
                  <span className="home-active-cwd">{s.cwd.split("/").pop()}</span>
                </div>
                <span className="home-active-time">{timeAgo(s.startedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity chart */}
      <div className="home-section">
        <h3 className="home-section-title">Activity</h3>
        <ActivityChart data={analytics.dailyActivity} days={period === "7d" ? 7 : period === "30d" ? 30 : undefined} />
      </div>

      {/* Two-column layout */}
      <div className="home-columns">
        {/* Profiles */}
        <div className="home-section">
          <h3 className="home-section-title">Profiles</h3>
          <div className="home-profile-grid">
            {profiles.map((p) => {
              const usage = analytics.profileUsage.find((u) => u.name === p.name);
              return (
                <div
                  key={p.name}
                  className="home-profile-card"
                  onClick={() => onSelectProfile(p.name)}
                >
                  <div className="home-profile-card-header">
                    <div className="home-profile-icon">
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="home-profile-info">
                      <div className="home-profile-name">{p.name}</div>
                      <div className="home-profile-meta">
                        {p.plugins.length} plugin{p.plugins.length !== 1 ? "s" : ""}
                        {usage ? ` · ${usage.messages} msgs` : ""}
                      </div>
                    </div>
                  </div>
                  <button
                    className="home-launch-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      launchWithDirPicker(p.name, p.directory, onLaunch);
                    }}
                    title="Launch profile"
                  >
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top projects */}
        <div className="home-section">
          <h3 className="home-section-title">Top Projects</h3>
          <div className="home-project-list">
            {analytics.topProjects.map((p) => (
              <div key={p.name} className="home-project-item">
                <span className="home-project-name">{p.name}</span>
                <span className="home-project-count">{p.messages.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent sessions */}
      <div className="home-section">
        <h3 className="home-section-title">Recent Sessions</h3>
        <div className="home-session-list">
          {analytics.recentSessions.map((s) => {
            const sessionProfile = profiles.find((p) => p.name === s.profile);
            return (
              <div key={s.sessionId} className="home-session-item">
                {sessionProfile && (
                  <div className="home-profile-icon" style={{ width: 22, height: 22, fontSize: "0.692rem", borderRadius: 4 }}>
                    {sessionProfile.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="home-session-project">{s.project}</span>
                {s.profile && <span className="home-session-profile">{s.profile}</span>}
                <span className="home-session-msgs">{s.messages} msgs</span>
                <span className="home-session-date">
                  {new Date(s.date + "T12:00:00").toLocaleDateString("en", { month: "short", day: "numeric" })}
                </span>
                {s.profile && s.directory && (
                  <button
                    className="home-session-launch"
                    onClick={() => onLaunch(s.profile!, s.directory)}
                    title={`Start new ${s.profile} session in ${s.project}`}
                  >
                    New session
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Profile usage */}
      {analytics.profileUsage.length > 0 && (
        <div className="home-section">
          <h3 className="home-section-title">Profile Activity</h3>
          <div className="home-profile-grid">
            {analytics.profileUsage.map((pu) => {
              const profile = profiles.find((p) => p.name === pu.name);
              return (
                <div
                  key={pu.name}
                  className="home-profile-card"
                  onClick={() => onSelectProfile(pu.name)}
                >
                  <div className="home-profile-card-header">
                    <div className="home-profile-icon">
                      {pu.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="home-profile-info">
                      <div className="home-profile-name">{pu.name}</div>
                      <div className="home-profile-meta">
                        {pu.sessions} session{pu.sessions !== 1 ? "s" : ""} · {pu.messages} msgs
                      </div>
                    </div>
                  </div>
                  {profile && (
                    <button
                      className="home-launch-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        launchWithDirPicker(profile.name, profile.directory, onLaunch);
                      }}
                      title="Launch profile"
                    >
                      <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
