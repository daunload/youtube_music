import PlaylistPicker from "@/components/playlist-picker";

export default function Page() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        YouTube 플레이리스트 선택
      </h1>
      <p style={{ marginBottom: 20, opacity: 0.8 }}>
        로그인 후 내 플레이리스트를 불러와 추천에 사용할 목록을 선택하세요.
      </p>

      <PlaylistPicker />
    </main>
  );
}
