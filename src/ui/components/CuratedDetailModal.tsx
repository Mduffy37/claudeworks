import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CuratedMarketplace, CuratedPlugin } from "../../electron/types";

type Target =
  | { kind: "marketplace"; entry: CuratedMarketplace }
  | { kind: "plugin"; entry: CuratedPlugin };

interface Props {
  target: Target;
  installedPluginIds: Set<string>;
  /** Set of marketplace `id`s that the user has already registered via `claude plugin marketplace add`. */
  registeredMarketplaceIds: Set<string>;
  onClose: () => void;
  onInstallPlugin: (pluginId: string) => Promise<void>;
  onAddMarketplace?: (marketplaceId: string) => Promise<void>;
  curatedInstalling: string | null;
  curatedErrors: Record<string, string>;
}

/** Parse `owner/repo` out of a GitHub URL (HTTPS or SSH). Duplicated from ManageDialog for self-containment. */
function parseOwnerRepo(url: string): string | null {
  if (!url) return null;
  const clean = url.replace(/\.git$/, "").replace(/\/$/, "");
  const match = clean.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\/.*)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** Resolve the `owner/repo` source for either target type. */
function resolveSource(target: Target): string | null {
  if (target.kind === "marketplace") return target.entry.source;
  return parseOwnerRepo(target.entry.sourceUrl);
}

export function CuratedDetailModal({
  target,
  installedPluginIds,
  registeredMarketplaceIds,
  onClose,
  onInstallPlugin,
  onAddMarketplace,
  curatedInstalling,
  curatedErrors,
}: Props) {
  const [readme, setReadme] = useState<string>("");
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const [peerPlugins, setPeerPlugins] = useState<Array<{ name: string; description?: string; source?: string }>>([]);
  const [peerLoading, setPeerLoading] = useState(false);
  const [peerError, setPeerError] = useState<string | null>(null);

  const source = useMemo(() => resolveSource(target), [target]);
  const displayName = target.entry.displayName;
  const description = target.entry.description;
  const author = target.entry.author;
  const sourceUrl = target.entry.sourceUrl;
  const collections = target.entry.collections;
  const featured = target.entry.featured;
  const addedAt = target.entry.addedAt;

  useEffect(() => {
    if (!source) {
      setReadmeError("Cannot resolve GitHub source for this entry.");
      return;
    }
    let cancelled = false;
    setReadmeLoading(true);
    setReadmeError(null);
    window.api
      .fetchRepoReadme(source)
      .then((content) => {
        if (cancelled) return;
        if (!content) setReadmeError("No README available for this repository.");
        else setReadme(content);
      })
      .catch((err: any) => {
        if (!cancelled) setReadmeError(err?.message ?? "Failed to fetch README");
      })
      .finally(() => {
        if (!cancelled) setReadmeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    if (target.kind !== "marketplace" || !source) return;
    let cancelled = false;
    setPeerLoading(true);
    setPeerError(null);
    window.api
      .fetchUpstreamMarketplace(source)
      .then((manifest: any) => {
        if (cancelled) return;
        const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
        setPeerPlugins(
          plugins.map((p: any) => ({
            name: p.name ?? "(unnamed)",
            description: p.description ?? "",
            source: p.source ?? "",
          }))
        );
      })
      .catch((err: any) => {
        if (!cancelled) setPeerError(err?.message ?? "Failed to fetch plugin list");
      })
      .finally(() => {
        if (!cancelled) setPeerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, source]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const installKey = target.kind === "marketplace" ? `mkt:${target.entry.id}` : target.entry.pluginId;
  const isInstalling = curatedInstalling === installKey;
  const installError = curatedErrors[installKey];
  const isInstalled =
    target.kind === "plugin" && installedPluginIds.has(target.entry.pluginId);
  const isAlreadyAdded =
    target.kind === "marketplace" && registeredMarketplaceIds.has(target.entry.id);

  const handlePrimaryAction = () => {
    if (target.kind === "marketplace" && onAddMarketplace) {
      onAddMarketplace(target.entry.id);
    } else if (target.kind === "plugin") {
      onInstallPlugin(target.entry.pluginId);
    }
  };

  return (
    <div className="modal-backdrop curated-detail-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="curated-detail-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="curated-detail-header">
          <div className="curated-detail-heading">
            <span className="curated-detail-kind-tag">{target.kind === "marketplace" ? "marketplace" : "plugin"}</span>
            <h2 className="curated-detail-title">{displayName}</h2>
            {featured && <span className="curated-detail-featured">featured</span>}
          </div>
          <button className="curated-detail-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="curated-detail-body">
          <div className="curated-detail-readme">
            {readmeLoading && <div className="curated-detail-loading">Loading README…</div>}
            {readmeError && <div className="curated-detail-message">{readmeError}</div>}
            {!readmeLoading && !readmeError && readme && (
              <div className="curated-detail-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // Intercept every link click inside rendered markdown.
                    // Without this, an <a href="..."> click would navigate the
                    // Electron webview itself (replacing the whole app UI).
                    // Absolute URLs open in the default browser via shell.openExternal.
                    // Relative paths are resolved against the repo's GitHub blob URL
                    // (main branch) since we don't know the default branch cheaply.
                    a: ({ href, children, ...rest }) => (
                      <a
                        {...rest}
                        href={href ?? "#"}
                        onClick={(e) => {
                          e.preventDefault();
                          if (!href) return;
                          let target = href;
                          if (/^https?:\/\//i.test(href)) {
                            // already absolute
                          } else if (href.startsWith("#")) {
                            // anchor link — no-op for now, in-modal scroll would need more work
                            return;
                          } else if (source) {
                            // Resolve relative link against the repo's blob URL
                            const cleaned = href.replace(/^\.\//, "").replace(/^\//, "");
                            target = `https://github.com/${source}/blob/main/${cleaned}`;
                          } else {
                            return;
                          }
                          window.api.openExternalUrl(target);
                        }}
                      >
                        {children}
                      </a>
                    ),
                    // Images also need their src resolved if relative — same repo logic.
                    img: ({ src, alt, ...rest }) => {
                      if (src && !/^https?:\/\//i.test(src) && source) {
                        const cleaned = (src as string).replace(/^\.\//, "").replace(/^\//, "");
                        const resolved = `https://raw.githubusercontent.com/${source}/main/${cleaned}`;
                        return <img {...rest} src={resolved} alt={alt} />;
                      }
                      return <img {...rest} src={src} alt={alt} />;
                    },
                  }}
                >
                  {readme}
                </ReactMarkdown>
              </div>
            )}
          </div>

          <aside className="curated-detail-sidebar">
            <div className="curated-detail-section">
              <div className="curated-detail-description">{description}</div>
              <div className="curated-detail-meta">
                <div>
                  <span className="curated-detail-meta-label">by</span> {author}
                </div>
                <div>
                  <span className="curated-detail-meta-label">added</span> {addedAt}
                </div>
                {source && (
                  <div>
                    <span className="curated-detail-meta-label">source</span>{" "}
                    <a
                      href={sourceUrl}
                      onClick={(e) => {
                        e.preventDefault();
                        window.api.openExternalUrl(sourceUrl);
                      }}
                    >
                      {source}
                    </a>
                  </div>
                )}
                {target.kind === "marketplace" && (
                  <div>
                    <span className="curated-detail-meta-label">plugins</span> {target.entry.pluginCount}
                  </div>
                )}
              </div>
              {collections.length > 0 && (
                <div className="curated-detail-tags">
                  {collections.map((c) => (
                    <span key={c} className="curated-detail-collection">{c}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="curated-detail-action">
              {isInstalled || isAlreadyAdded ? (
                <button className="btn-secondary curated-detail-primary" disabled>
                  {isInstalled ? "Installed" : "Added"}
                </button>
              ) : (
                <button
                  className="btn-primary curated-detail-primary"
                  onClick={handlePrimaryAction}
                  disabled={isInstalling}
                >
                  {target.kind === "marketplace"
                    ? isInstalling
                      ? "Adding…"
                      : "Add marketplace"
                    : isInstalling
                      ? "Installing…"
                      : "Install plugin"}
                </button>
              )}
              {installError && <div className="curated-install-error">{installError}</div>}
            </div>

            {target.kind === "marketplace" && (
              <div className="curated-detail-section">
                <div className="curated-detail-section-title">
                  Plugins in this marketplace
                  {peerPlugins.length > 0 && <span className="curated-detail-count"> · {peerPlugins.length}</span>}
                </div>
                {peerLoading && <div className="curated-detail-loading">Loading plugin list…</div>}
                {peerError && <div className="curated-detail-message">{peerError}</div>}
                {!peerLoading && !peerError && peerPlugins.length > 0 && (
                  <ul className="curated-detail-peer-list">
                    {peerPlugins.map((p) => (
                      <li key={p.name} className="curated-detail-peer">
                        <div className="curated-detail-peer-name">{p.name}</div>
                        {p.description && (
                          <div className="curated-detail-peer-desc">{p.description}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
