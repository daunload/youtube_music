import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";

function cleanTitle(s: string) {
  return s
    .replace(/\s+/g, " ")
    .replace(/\[(.*?)\]|\((.*?)\)/g, " ") // 간단히 괄호/대괄호 제거(선택)
    .trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawTitles: unknown = body?.titles;
    const max = Math.min(Number(body?.max ?? 15), 30);

    if (!Array.isArray(rawTitles) || rawTitles.length === 0) {
      return NextResponse.json(
        { error: "titles(array) is required" },
        { status: 400 }
      );
    }

    // 전처리(중복 제거 + 너무 긴 입력 방지)
    const titles = Array.from(
      new Set(
        rawTitles
          .filter((x) => typeof x === "string")
          .map((x) => cleanTitle(x))
          .filter(Boolean)
      )
    ).slice(0, 150);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not set" },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
                text: "너는 '개인화 + 발견형(discovery) 음악 추천 엔진'이다.\n" +
                    "입력은 사용자가 좋아하는 YouTube 플레이리스트의 영상 제목 목록이다.\n" +
                    "목표는 2가지다:\n" +
                    "A) 사용자의 취향을 강하게 반영한 추천\n" +
                    "B) 한 번도 몰랐던 아티스트를 알게 해주는 '다양성/발견' 추천\n\n" +

                    "제목 목록은 노이즈(Official Video, MV, Lyrics, Live, Remix, Cover 등)가 많고 곡/아티스트 표기가 불완전할 수 있다.\n" +
                    "따라서 먼저 취향 신호를 추출해 '취향 프로필'을 만든 뒤, 그 프로필을 근거로 추천을 생성해라.\n\n" +

                    "작업 순서(반드시 지켜라):\n" +
                    "1) 제목 목록에서 핵심 취향 신호를 추출해 프로필을 만든다:\n" +
                    "   - 장르/서브장르(예: indie rock, shoegaze, city pop, lo-fi hiphop 등)\n" +
                    "   - 분위기(에너지/감정), 템포 경향\n" +
                    "   - 시대/사운드 감성(예: 90s, 00s, 10s), 언어권\n" +
                    "   - 보컬/연주 성향(밴드/전자/랩 비중), 라이브/커버 선호\n" +
                    "   - 반복 등장 아티스트/레이블/씬 키워드\n" +
                    "2) 아래의 '탐색 전략'을 적용해서 추천을 만든다.\n\n" +

                    "탐색 전략(핵심):\n" +
                    `- 추천은 정확히 ${max}개.\n` +
                    "- 추천 리스트는 3개 버킷으로 구성하라(버킷 비율을 지켜라):\n" +
                    `  (1) Core Fit (약 40%): 사용자가 매우 좋아할 확률이 높은 '취향 정합' 곡\n` +
                    `  (2) Discovery (약 40%): '유명하지 않아도' 취향 결이 맞는 인디/신진/언더그라운드 아티스트 중심\n` +
                    `  (3) Bridge (약 20%): Core와 Discovery를 이어주는 연결고리(조금 더 대중적이지만 결이 같은 곡)\n\n` +

                    "다양성 제약(반드시):\n" +
                    "- (중요) 아티스트 중복을 강하게 제한하라: 동일 아티스트는 최대 1곡만 추천.\n" +
                    "- 입력 목록에 이미 많이 등장한 '메이저 아티스트'와 동일한 추천은 최소화하고, 유사한 결의 다른 아티스트를 찾는다.\n" +
                    "- Discovery 버킷은 가능한 한 '상대적으로 덜 알려진' 아티스트를 우선한다(인디 밴드 포함).\n\n" +

                    "정확성/안전 규칙:\n" +
                    "- 가능한 한 '실존하는' 아티스트/곡을 추천하고, 확실치 않으면 reason 끝에 '(추정)'을 붙여라.\n" +
                    "- 존재하지 않는 곡/아티스트를 만들어내지 마라.\n\n" +

                    "출력 요구(각 추천마다 포함):\n" +
                    "  * bucket: CoreFit | Discovery | Bridge\n" +
                    "  * artist: 아티스트/밴드\n" +
                    "  * title: 곡명\n" +
                    "  * reason: 입력 취향 신호(장르/무드/사운드/유사 아티스트 등)를 근거로 1~2문장\n" +
                    "  * moodTags: 분위기 태그 정확히 3개\n" +
                    "  * query: YouTube 검색 정확도를 높이기 위한 문자열 (형식: \"ARTIST - TITLE official audio\")\n" +
                    "  * confidence: 0~1 (이 추천이 취향에 맞을 확률)\n" +
                    "  * novelty: 0~1 (사용자에게 '새로울' 확률; Discovery는 높게)\n\n" +

                    "입력 제목 목록:\n" +
                titles.map((t, i) => `${i + 1}. ${t}`).join("\n"),
            },
          ],
        },
      ],
      config: {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            profile: {
              type: "object",
              description: "입력 제목 기반 취향 요약",
              properties: {
                genres: { type: "array", items: { type: "string" } },
                moods: { type: "array", items: { type: "string" } },
                notes: { type: "string" },
              },
              required: ["genres", "moods", "notes"],
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  artist: { type: "string" },
                  title: { type: "string" },
                  reason: { type: "string" },
                  moodTags: { type: "array", items: { type: "string" } },
                  query: {
                    type: "string",
                    description: "YouTube 검색에 쓰기 좋은 문자열 (artist + title)",
                  },
                },
                required: ["artist", "title", "reason", "moodTags", "query"],
              },
            },
          },
          required: ["profile", "recommendations"],
        },
      },
    });

    // @google/genai는 response.text에 JSON 문자열이 들어옵니다. :contentReference[oaicite:3]{index=3}
    const text = response.text ?? "";
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Model did not return valid JSON", raw: text },
        { status: 502 }
      );
    }

    return NextResponse.json(json);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
