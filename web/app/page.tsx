import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 40 }}>
      <Link href="/app/">Open the app</Link>
    </main>
  );
}
