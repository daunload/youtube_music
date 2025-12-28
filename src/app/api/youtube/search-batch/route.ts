import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export const runtime = "nodejs";

async function ytSearchOne(query: string, accessToken: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("q", query);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || "YouTube search error";
    throw Object.assign(new Error(msg), { status: res.status, details: data });
  }

  const item = data?.items?.[0];
  const videoId = item?.id?.videoId ?? null;
  const title = item?.snippet?.title ?? null;
  const channelTitle = item?.snippet?.channelTitle ?? null;

  return { videoId, title, channelTitle };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;

  const workers = new Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx], idx);
      }
    });

  await Promise.all(workers);
  return results;
}

/**
 * POST /api/youtube/search-batch
 * body: { queries: string[], maxPerBatch?: number }
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = (session as any)?.accessToken;

    if (!accessToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const queriesRaw: unknown = body?.queries;
    const maxPerBatch = Math.min(Number(body?.maxPerBatch ?? 10), 15); // 안전 상한

    if (!Array.isArray(queriesRaw) || queriesRaw.length === 0) {
      return NextResponse.json({ error: "queries(array) is required" }, { status: 400 });
    }

    const queries = queriesRaw
      .filter((q) => typeof q === "string")
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, maxPerBatch);

    const results = await mapWithConcurrency(
      queries,
      3, // 동시성 3
      async (q) => {
        try {
          const r = await ytSearchOne(q, accessToken);
          return { query: q, ...r, ok: true as const };
        } catch (e: any) {
          return {
            query: q,
            videoId: null,
            title: null,
            channelTitle: null,
            ok: false as const,
            error: e?.message ?? "search failed",
          };
        }
      }
    );

    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
