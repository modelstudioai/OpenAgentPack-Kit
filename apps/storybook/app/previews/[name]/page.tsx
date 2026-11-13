import { notFound } from "next/navigation";
import { ShowcaseDemo } from "../../../components/showcase.tsx";
import { isShowcaseName, SHOWCASE_NAMES } from "../../../lib/showcase-names.ts";

export const dynamicParams = false;
export const metadata = { robots: { index: false, follow: false } };

export function generateStaticParams() {
	return SHOWCASE_NAMES.map((name) => ({ name }));
}

export default async function PreviewPage({ params }: { params: Promise<{ name: string }> }) {
	const { name } = await params;
	if (!isShowcaseName(name)) notFound();
	return (
		<main className="kit-demo-page" data-kit-appearance={name === "sender" ? undefined : "workspace"}>
			<ShowcaseDemo name={name} />
		</main>
	);
}
