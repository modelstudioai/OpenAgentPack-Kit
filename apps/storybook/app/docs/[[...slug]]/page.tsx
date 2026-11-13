import type { TOCItemType } from "fumadocs-core/toc";
import type { OpenAPIPageProps } from "fumadocs-openapi/ui";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { OpenAPIPage } from "../../../components/openapi-page.tsx";
import { mdxComponents } from "../../../lib/mdx-components.tsx";
import { source } from "../../../lib/source.ts";

/** MDX 编译产物（不引 mdx/types：文档站不需要它的完整类型面）。 */
type MDXContent = (props: Record<string, unknown>) => ReactElement | null;

/** loader 合并了两个来源，`page.data` 是联合类型：这里按「有没有 getOpenAPIPageProps」分流。 */
interface OpenAPIPageData {
	getOpenAPIPageProps: () => OpenAPIPageProps;
	title: string;
	description?: string;
	toc?: TOCItemType[];
}

interface MdxPageData {
	body: MDXContent;
	title: string;
	description?: string;
	toc?: TOCItemType[];
	full?: boolean;
}

function isOpenAPIPage(data: unknown): data is OpenAPIPageData {
	return typeof data === "object" && data !== null && "getOpenAPIPageProps" in data;
}

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) notFound();

	if (isOpenAPIPage(page.data)) {
		return <OpenAPIPage {...page.data.getOpenAPIPageProps()} />;
	}

	const data = page.data as MdxPageData;
	const MDX = data.body;
	return (
		<DocsPage toc={data.toc ?? []} full={data.full}>
			<DocsTitle>{data.title}</DocsTitle>
			<DocsDescription>{data.description}</DocsDescription>
			<DocsBody>
				<MDX components={mdxComponents} />
			</DocsBody>
		</DocsPage>
	);
}

export async function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }): Promise<{ title: string }> {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) notFound();
	return { title: (page.data as { title: string }).title };
}
