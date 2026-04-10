import React, { useState, useEffect } from "react";
import type { AnalyticsData, Profile } from "../../electron/types";

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

function ActivityChart({ data }: { data: AnalyticsData["dailyActivity"] }) {
  const [hovered, setHovered] = useState<{ date: string; messages: number; x: number; y: number } | null>(null);
  const filled = fillDays(data, 30);
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

export function Home({ profiles, onSelectProfile, onLaunch }: Props) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.getAnalytics().then((data) => {
      setAnalytics(data);
      setLoading(false);
    });
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

      {/* Activity chart */}
      <div className="home-section">
        <h3 className="home-section-title">Activity (last 30 days)</h3>
        <ActivityChart data={analytics.dailyActivity} />
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
                      onLaunch(p.name, p.directory);
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
          {analytics.recentSessions.map((s) => (
            <div key={s.sessionId} className="home-session-item">
              <span className="home-session-project">{s.project}</span>
              <span className="home-session-msgs">{s.messages} msgs</span>
              <span className="home-session-date">{s.date}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
