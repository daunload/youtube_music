"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

type YtPlaylist = {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
  contentDetails?: { itemCount?: number };
};

type PlaylistVideoItem = {
  videoId: string | null;
  missing: boolean;
  playlistSnapshot: {
    title: string | null;
    thumbnails: any | null;
    position: number | null;
  };
  video: null | {
    id: string;
    snippet: {
      title?: string;
      channelTitle?: string;
      thumbnails?: any;
    } | null;
    contentDetails: { duration?: string } | null;
    statistics: { viewCount?: string } | null;
  };
};

type GeminiRecommendation = {
  artist: string;
  title: string;
  reason: string;
  moodTags: string[];
  query: string; // YouTube 검색용
  // 아래는 우리가 매칭해서 붙일 필드
  matched?: {
    videoId: string | null;
    title: string | null;
    channelTitle: string | null;
  };
};

type GeminiResponse = {
  profile: { genres: string[]; moods: string[]; notes: string };
  recommendations: GeminiRecommendation[];
};

function formatDuration(iso?: string) {
  if (!iso) return "-";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "-";
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const total = h * 3600 + min * 60 + s;
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function formatNumber(n?: string) {
  if (!n) return "-";
  const x = Number(n);
  if (!Number.isFinite(x)) return n;
  return x.toLocaleString();
}

export default function PlaylistPicker() {
  const { data: session, status } = useSession();
  const isAuthed = status === "authenticated";

  // playlists
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<YtPlaylist[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [selected, setSelected] = useState<YtPlaylist | null>(null);

  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState<string | null>(null);
  const [videos, setVideos] = useState<PlaylistVideoItem[]>([]);
  const [videosLimit, setVideosLimit] = useState(200);

  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [recData, setRecData] = useState<GeminiResponse | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter((p) => {
      const title = p.snippet?.title?.toLowerCase() ?? "";
      const desc = p.snippet?.description?.toLowerCase() ?? "";
      return title.includes(q) || desc.includes(q);
    });
  }, [playlists, query]);

  async function fetchPlaylists(pageToken?: string) {
    setLoading(true);
    setError(null);

    try {
      const url = new URL("/api/youtube/playlists", window.location.origin);
      url.searchParams.set("maxResults", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url.toString(), { cache: "no-store" });
      const data = await res.json();

      if (!res.ok) {
        const msg = data?.details?.error?.message || data?.error || "Failed to fetch playlists";
        throw new Error(msg);
      }

      const items: YtPlaylist[] = data.items ?? [];
      setPlaylists((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const it of items) if (!seen.has(it.id)) merged.push(it);
        return merged;
      });

      setNextPageToken(data.nextPageToken ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthed && playlists.length === 0 && !loading) fetchPlaylists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  function toggleSelect(p: YtPlaylist) {
    setSelected((prev) => (prev?.id === p.id ? null : p));
  }

  function clearSelected() {
    setSelected(null);
    setVideos([]);
    setVideosError(null);
    setRecData(null);
    setRecError(null);
  }

  function resetAndReload() {
    setPlaylists([]);
    setNextPageToken(null);
    setQuery("");
    clearSelected();
    fetchPlaylists();
  }

  async function fetchPlaylistVideos(playlistId: string, limit: number) {
    setVideosLoading(true);
    setVideosError(null);

    try {
      const url = new URL("/api/youtube/playlist-details", window.location.origin);
      url.searchParams.set("playlistId", playlistId);
      url.searchParams.set("limit", String(limit));

      const res = await fetch(url.toString(), { cache: "no-store" });
      const data = await res.json();

      if (!res.ok) {
        const msg = data?.details?.error?.message || data?.error || "Failed to fetch playlist videos";
        throw new Error(msg);
      }

      setVideos((data.items ?? []) as PlaylistVideoItem[]);
    } catch (e: any) {
      setVideosError(e?.message ?? "Unknown error");
      setVideos([]);
    } finally {
      setVideosLoading(false);
    }
  }

  // selected playlist -> load videos
  useEffect(() => {
    if (!isAuthed) return;

    if (!selected) {
      setVideos([]);
      setVideosError(null);
      setRecData(null);
      setRecError(null);
      return;
    }

    fetchPlaylistVideos(selected.id, videosLimit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, isAuthed, videosLimit]);

  // ✅ 추천 요청: videos에서 제목 추출 -> /api/recommend -> 결과 렌더 -> /api/youtube/search-batch로 매칭
  async function requestRecommendations() {
    if (!selected) return;

    setRecLoading(true);
    setRecError(null);
    setRecData(null);

    try {
      const titles = videos
        .map((it) => it.video?.snippet?.title ?? it.playlistSnapshot?.title)
        .filter(Boolean) as string[];

      if (titles.length === 0) throw new Error("플레이리스트 영상 제목을 가져오지 못했어요.");

      // 1) Gemini 추천
      const recRes = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // max는 10~15 정도가 UX/비용/쿼터 밸런스 좋음
        body: JSON.stringify({ titles, max: 12 }),
      });

      const recJson = (await recRes.json()) as any;
      if (!recRes.ok) throw new Error(recJson?.error ?? "Recommend failed");

      const parsed: GeminiResponse = recJson;

      // 2) YouTube 매칭(추천 query를 실제 videoId로 변환)
      const queries = (parsed.recommendations ?? []).map((r) => r.query).filter(Boolean);

      const matchRes = await fetch("/api/youtube/search-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries, maxPerBatch: 12 }),
      });

      const matchJson = await matchRes.json();
      if (!matchRes.ok) throw new Error(matchJson?.error ?? "YouTube match failed");

      const map = new Map<string, { videoId: string | null; title: string | null; channelTitle: string | null }>();
      for (const r of matchJson.results ?? []) {
        map.set(r.query, { videoId: r.videoId ?? null, title: r.title ?? null, channelTitle: r.channelTitle ?? null });
      }

      parsed.recommendations = (parsed.recommendations ?? []).map((r) => ({
        ...r,
        matched: map.get(r.query) ?? { videoId: null, title: null, channelTitle: null },
      }));

      setRecData(parsed);
    } catch (e: any) {
      setRecError(e?.message ?? "Unknown error");
    } finally {
      setRecLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* Header / Auth Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900">계정</div>
          <div className="mt-1 text-sm text-gray-600">
            {status === "loading" && "세션 확인 중..."}
            {status === "unauthenticated" && "로그인이 필요합니다."}
            {status === "authenticated" && (
              <>
                <span className="font-medium text-gray-900">{session?.user?.name ?? "사용자"}</span>
                <span className="text-gray-500">{session?.user?.email ? ` · ${session.user.email}` : ""}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isAuthed ? (
            <button
              onClick={() => signIn("google")}
              className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800"
            >
              Google로 로그인
            </button>
          ) : (
            <>
              <button
                onClick={resetAndReload}
                disabled={loading}
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                새로고침
              </button>
              <button
                onClick={() => signOut()}
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-50"
              >
                로그아웃
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
          <div className="text-sm font-semibold text-red-900">에러</div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-red-800">{error}</div>
        </div>
      )}

      {/* Controls */}
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색: 제목/설명"
            disabled={!isAuthed}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-900 disabled:cursor-not-allowed disabled:bg-gray-50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900">
            선택: <span className="tabular-nums">{selected ? "1" : "0"}</span>/1
          </div>

          <button
            onClick={clearSelected}
            disabled={!isAuthed || !selected}
            className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            선택 해제
          </button>
        </div>
      </div>

      {/* Playlists */}
      {!isAuthed ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          로그인 후 플레이리스트를 불러올 수 있어요.
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span>{loading ? "불러오는 중..." : `표시 ${filtered.length}개 · 로드 ${playlists.length}개`}</span>
          </div>

          <div className="mt-4 grid gap-3">
            {filtered.map((p) => {
              const title = p.snippet?.title ?? "(제목 없음)";
              const thumb =
                p.snippet?.thumbnails?.medium?.url ||
                p.snippet?.thumbnails?.default?.url ||
                p.snippet?.thumbnails?.high?.url ||
                "";

              const isSelected = selected?.id === p.id;

              return (
                <button
                  key={p.id}
                  onClick={() => toggleSelect(p)}
                  className={[
                    "group flex w-full items-center gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm transition",
                    isSelected
                      ? "border-gray-900 bg-gray-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50",
                  ].join(" ")}
                >
                  <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={thumb} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-xs text-gray-500">No Image</div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-extrabold text-gray-900">{title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-gray-200">
                        아이템 <span className="tabular-nums">{p.contentDetails?.itemCount ?? "?"}</span>개
                      </span>
                      <span className="truncate text-gray-500">ID: {p.id}</span>
                    </div>
                  </div>

                  <div className="flex-none">
                    <span
                      className={[
                        "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold",
                        isSelected
                          ? "bg-gray-900 text-white"
                          : "bg-gray-100 text-gray-900 group-hover:bg-gray-200",
                      ].join(" ")}
                    >
                      {isSelected ? "선택됨" : "선택"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex justify-center">
            <button
              onClick={() => fetchPlaylists(nextPageToken ?? undefined)}
              disabled={loading || !nextPageToken}
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              title={!nextPageToken ? "더 불러올 플레이리스트가 없어요." : ""}
            >
              더 불러오기
            </button>
          </div>
        </>
      )}

      {/* Selected playlist videos + AI */}
      {isAuthed && selected && (
        <div className="mt-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-extrabold text-gray-900">선택한 플레이리스트</div>
              <div className="mt-1 text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{selected.snippet?.title ?? "(제목 없음)"}</span>
                <span className="text-gray-500"> · {selected.id}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={requestRecommendations}
                disabled={recLoading || videosLoading || videos.length === 0}
                className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                title={videos.length === 0 ? "먼저 영상 목록을 불러와야 해요." : ""}
              >
                {recLoading ? "AI 추천 생성 중..." : "AI 추천 받기"}
              </button>
            </div>
          </div>

          {/* videos errors */}
          {videosError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
              <div className="text-sm font-semibold text-red-900">영상 에러</div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-red-800">{videosError}</div>
            </div>
          )}

          <div className="mt-3 text-sm text-gray-600">
            {videosLoading ? "영상 불러오는 중..." : `영상 ${videos.length}개`}
          </div>

          {/* ✅ AI recommendation section */}
          <div className="mt-8">
            <div className="text-sm font-extrabold text-gray-900">AI 추천 결과</div>

            {recError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
                <div className="text-sm font-semibold text-red-900">추천 에러</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-red-800">{recError}</div>
              </div>
            )}

            {!recLoading && !recData && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                “AI 추천 받기”를 누르면 선택한 플레이리스트 기반 추천을 생성합니다.
              </div>
            )}

            {recData && (
              <>
                {/* profile */}
                <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="text-sm font-extrabold text-gray-900">취향 요약</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {recData.profile.genres.map((g, i) => (
                      <span key={`g-${i}`} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-900">
                        #{g}
                      </span>
                    ))}
                    {recData.profile.moods.map((m, i) => (
                      <span key={`m-${i}`} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-900">
                        #{m}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{recData.profile.notes}</div>
                </div>

                {/* recommendations */}
                <div className="mt-4 grid gap-3">
                  {recData.recommendations.map((r, idx) => {
                    const videoId = r.matched?.videoId ?? null;
                    const ytTitle = r.matched?.title ?? null;
                    const ytChannel = r.matched?.channelTitle ?? null;

                    return (
                      <div key={`${r.artist}-${r.title}-${idx}`} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-extrabold text-gray-900">
                              {idx + 1}. {r.artist} — {r.title}
                            </div>
                            <div className="mt-1 text-sm text-gray-700">{r.reason}</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {r.moodTags.slice(0, 6).map((t, i) => (
                                <span
                                  key={`${idx}-tag-${i}`}
                                  className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-900"
                                >
                                  #{t}
                                </span>
                              ))}
                            </div>

                            <div className="mt-3 text-xs text-gray-500">
                              검색어: <span className="font-semibold text-gray-700">{r.query}</span>
                            </div>

                            {ytTitle && (
                              <div className="mt-1 text-xs text-gray-500">
                                매칭: <span className="font-semibold text-gray-700">{ytTitle}</span>
                                {ytChannel ? <span className="text-gray-500"> · {ytChannel}</span> : null}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {videoId ? (
                              <a
                                href={`https://www.youtube.com/watch?v=${videoId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-800"
                              >
                                YouTube
                              </a>
                            ) : (
                              <span className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-600">
                                매칭 실패
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
