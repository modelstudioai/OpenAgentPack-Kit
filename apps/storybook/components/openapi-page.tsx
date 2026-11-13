"use client";

import type { OpenAPIPageProps } from "fumadocs-openapi/ui";
import { createOpenAPIPage } from "fumadocs-openapi/ui";

/**
 * `createOpenAPIPage()` 是客户端函数，不能在 server component 里调用；
 * 这里包一层客户端组件，服务端页面只负责把 props 传进来。
 */
const Generated = createOpenAPIPage();

export function OpenAPIPage(props: OpenAPIPageProps) {
	return <Generated {...props} />;
}
