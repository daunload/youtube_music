import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export const runtime = "nodejs";

type PlaylistItem = {
  snippet?: {
    title?: string;
    description?: string;
    thumbnails?: any;
    position?: number;
  };
  contentDetails?: {
    videoId?: string;
    videoPublishedAt?: string;
  };
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function ytFetch(url: URL, accessToken: string) {
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || "YouTube API error";
    throw Object.assign(new Error(msg), { status: res.status, details: data });
  }
  return data;
}

/**
 * GET /api/youtube/playlist-details?playlistId=...&limit=200&pageToken=...
 *
 * - limit: 총 몇 개까지 가져올지 (기본 200, 최대 1000 권장)
 * - pageToken: 필요하면 다음 페이지 토큰을 받아 재호출 가능
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = (session as any)?.accessToken;

    if (!accessToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const playlistId = searchParams.get("playlistId");
    const limit = Math.min(Number(searchParams.get("limit") ?? "200"), 1000);
    const startPageToken = searchParams.get("pageToken") ?? "";

    if (!playlistId) {
      return NextResponse.json(
        { error: "playlistId is required" },
        { status: 400 }
      );
    }

    // 1) playlistItems.list로 videoId 목록 수집 (페이지네이션)
    let items: PlaylistItem[] = [];
    let pageToken: string | null = startPageToken || null;

    while (items.length < limit) {
      const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
      url.searchParams.set("part", "snippet,contentDetails");
      url.searchParams.set("playlistId", playlistId);
      url.searchParams.set("maxResults", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const data = await ytFetch(url, accessToken);

      const batch: PlaylistItem[] = data.items ?? [];
      items = items.concat(batch);

      pageToken = data.nextPageToken ?? null;

      // 더 가져올게 없거나 limit 채웠으면 종료
      if (!pageToken || items.length >= limit) break;
    }

    items = items.slice(0, limit);

    const videoIds = items
      .map((it) => it.contentDetails?.videoId)
      .filter(Boolean) as string[];

    // videoId가 없을 수도 있음(이상 케이스)
    if (videoIds.length === 0) {
      return NextResponse.json({
        playlistId,
        count: 0,
        nextPageToken: pageToken, // 다음 페이지 있으면 전달
        items: [],
      });
    }

    // 2) videos.list로 최신 상세정보 조회 (50개씩 배치)
    const idChunks = chunk(videoIds, 50);

    const videoItems = (
      await Promise.all(
        idChunks.map(async (ids) => {
          const url = new URL("https://www.googleapis.com/youtube/v3/videos");
          url.searchParams.set(
            "part",
            "snippet,contentDetails,statistics,status"
          );
          url.searchParams.set("id", ids.join(","));
          const data = await ytFetch(url, accessToken);
          return (data.items ?? []) as any[];
        })
      )
    ).flat();

    const videoMap = new Map<string, any>(
      videoItems.map((v) => [v.id as string, v])
    );

    // 3) 원래 재생목록 순서를 유지하며 합치기
    const enriched = items.map((it) => {
      const vid = it.contentDetails?.videoId ?? null;
      const video = vid ? videoMap.get(vid) ?? null : null;

      return {
        videoId: vid,
        // playlistItems의 스냅샷(추가 당시 정보)
        playlistSnapshot: {
          title: it.snippet?.title ?? null,
          description: it.snippet?.description ?? null,
          thumbnails: it.snippet?.thumbnails ?? null,
          position: it.snippet?.position ?? null,
          videoPublishedAt: it.contentDetails?.videoPublishedAt ?? null,
        },
        // videos.list의 최신/정확 정보(없으면 삭제/비공개 등)
        video: video
          ? {
              id: video.id,
              snippet: video.snippet ?? null, // title, description, thumbnails, channelTitle...
              contentDetails: video.contentDetails ?? null, // duration
              statistics: video.statistics ?? null, // viewCount, likeCount, commentCount...
              status: video.status ?? null, // privacyStatus 등(일부)
            }
          : null,
        // 삭제/비공개 등으로 videos.list에 안 잡히면 null
        missing: vid ? !videoMap.has(vid) : true,
      };
    });

    return NextResponse.json({
      playlistId,
      requestedLimit: limit,
      returnedCount: enriched.length,
      nextPageToken: pageToken, // 더 가져올 수 있으면 토큰 제공
      items: enriched,
    });
  } catch (e: any) {
    const status = e?.status ?? 500;
    return NextResponse.json(
      {
        error: e?.message ?? "Server error",
        details: e?.details ?? null,
      },
      { status }
    );
  }
}
