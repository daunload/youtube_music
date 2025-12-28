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

export default function PlaylistPicker() {
  const { data: session, status } = useSession();
  const isAuthed = status === "authenticated";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [playlists, setPlaylists] = useState<YtPlaylist[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);

  const [query, setQuery] = useState("");

  const [selected, setSelected] = useState<YtPlaylist | null>(null);

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

      console.log(data)

      if (!res.ok) {
        const msg =
          data?.details?.error?.message ||
          data?.error ||
          "Failed to fetch playlists";
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

  // 로그인 되면 자동 로드 (첫 페이지)
  useEffect(() => {
    if (isAuthed && playlists.length === 0 && !loading) {
      fetchPlaylists();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  function toggleSelect(p: YtPlaylist) {
    setSelected((prev) => (prev?.id === p.id ? null : p));
  }

  function clearSelected() {
    setSelected(null);
  }

  function proceed() {
    if (!selected) return;
    alert(`선택됨:\n${selected.snippet?.title ?? "(제목 없음)"}\n${selected.id}`);
  }

  function resetAndReload() {
    setPlaylists([]);
    setNextPageToken(null);
    setQuery("");
    clearSelected();
    fetchPlaylists();
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
                <span className="font-medium text-gray-900">
                  {session?.user?.name ?? "사용자"}
                </span>
                <span className="text-gray-500">
                  {session?.user?.email ? ` · ${session.user.email}` : ""}
                </span>
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
          <div className="mt-1 whitespace-pre-wrap text-sm text-red-800">
            {error}
          </div>
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
            선택:{" "}
            <span className="tabular-nums">{selected ? "1" : "0"}</span>/1
          </div>

          <button
            onClick={clearSelected}
            disabled={!isAuthed || !selected}
            className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            선택 해제
          </button>

          <button
            onClick={proceed}
            disabled={!isAuthed || !selected}
            className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            다음 단계
          </button>
        </div>
      </div>

      {/* Status line */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <span>
          {loading
            ? "불러오는 중..."
            : `표시 ${filtered.length}개 · 로드 ${playlists.length}개`}
        </span>
      </div>

      {/* Content */}
      {!isAuthed ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          로그인 후 플레이리스트를 불러올 수 있어요.
        </div>
      ) : (
        <>
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
                  {/* Thumbnail */}
                  <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        src={thumb}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-xs text-gray-500">
                        No Image
                      </div>
                    )}
                  </div>

                  {/* Text */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-extrabold text-gray-900">
                      {title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-gray-200">
                        아이템{" "}
                        <span className="tabular-nums">
                          {p.contentDetails?.itemCount ?? "?"}
                        </span>
                        개
                      </span>
                      <span className="truncate text-gray-500">ID: {p.id}</span>
                    </div>
                  </div>

                  {/* Badge */}
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

            {filtered.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                검색 결과가 없어요.
              </div>
            )}
          </div>

          {/* Load more */}
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
    </section>
  );
}
