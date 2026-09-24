import { PlayerScreen } from "./player-screen";

export default async function JoinRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PlayerScreen code={code.toUpperCase()} />;
}
