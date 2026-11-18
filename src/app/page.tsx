import { BRAND } from "@/lib/brand";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="text-2xl font-semibold">{BRAND.name}</h1>
      <p className="mt-2 text-neutral-600">{BRAND.tagline}</p>
    </main>
  );
}
