/** 候选与详情共用文本投影：隐藏凭据、认证文本和 URL 内的认证、查询及片段。 */
export function redactRemoteDetailText(value: string): string {
	// 先隐藏完整 scheme + token，避免键值匹配只吞掉 Basic/Bearer 后留下凭据。
	return value
		.replace(/\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, "[redacted]")
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (match) => {
			try {
				const url = new URL(match);
				url.username = "";
				url.password = "";
				url.search = "";
				url.hash = "";
				return url.href;
			} catch {
				return "[redacted]";
			}
		})
		.replace(
			/\b(api[_-]?key|access[_-]?key|authorization|password|secret|token|signature)\s*[=:]\s*(?!\$\{)[^\s&,;]+/gi,
			"$1=[redacted]",
		);
}
