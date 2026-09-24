import { HostScreen } from "./host-screen";

export default async function HostPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <HostScreen code={code.toUpperCase()} />;
}
